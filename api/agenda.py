"""Busca a agenda da sala direto do Google Calendar a cada chamada (sem processo contínuo,
sem arquivo de token: credenciais vêm de variáveis de ambiente). Reaproveita as funções já
testadas de coletor/trazer-agenda-de-setembro.py — só a obtenção das credenciais muda."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import datetime
import importlib.util
import json
import os

from google.auth.transport.requests import AuthorizedSession
from google.oauth2.credentials import Credentials

def _carregar_modulo(nome, caminho):
    spec = importlib.util.spec_from_file_location(nome, caminho)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


_AQUI = os.path.dirname(__file__)
read_session = _carregar_modulo("sessao_auth", os.path.join(_AQUI, "_lib", "session.py")).read_session
_COLLECTOR_PATH = os.path.join(os.path.dirname(__file__), "..", "coletor", "trazer-agenda-de-setembro.py")
coletor = _carregar_modulo("coletor_agenda", _COLLECTOR_PATH)


def _credenciais():
    faltando = [nome for nome in ("GOOGLE_REFRESH_TOKEN", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET") if not os.environ.get(nome)]
    if faltando:
        raise coletor.ErroAgenda("Configuração incompleta no servidor: faltam " + ", ".join(faltando) + ".")
    return Credentials(
        None,
        refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_OAUTH_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_OAUTH_CLIENT_SECRET"],
        scopes=[coletor.ESCOPO_EVENTOS],
    )


def buscar_agenda(ano, mes):
    salas = coletor.resolver_salas(None)
    inicio, fim = coletor.periodo_mensal(ano, mes)
    relatorio = {
        "ano": ano, "mes": mes, "time_min": inicio, "time_max": fim, "fuso": "UTC-03:00",
        "gerado_em": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "modo": "oauth_usuario", "origem_coleta": "agendas_das_salas",
        "escopo": "Somente as agendas das salas selecionadas; sem listar contas da organização.",
        "total_agendas": len(salas), "coleta_finalizada": False, "agendas": [],
    }
    creds = _credenciais()
    with AuthorizedSession(creds, refresh_timeout=25) as sessao:
        for sala in salas:
            resultado = coletor.coletar_agenda(sessao, {"primaryEmail": sala["email"], "name": {"fullName": sala["nome"]}}, inicio, fim)
            resultado["tipo"] = "sala"
            relatorio["agendas"].append(resultado)
    erros = [item for item in relatorio["agendas"] if item["status"] == "erro"]
    if erros:
        # Sem snapshot para preservar (nada fica salvo em disco): o front mantém os últimos
        # dados recebidos com sucesso e tenta de novo na próxima consulta periódica.
        raise coletor.ErroAgenda(erros[0].get("erro") or "Falha na consulta ao Google Calendar.")
    relatorio["coleta_finalizada"] = True
    gestao = coletor.analisar_salas(relatorio, None)
    return coletor.exportacao_da_sala(relatorio, gestao)


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = os.environ.get("ALLOWED_ORIGIN", "")
        if origin and self.headers.get("Origin") == origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

    def _json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        if not read_session(dict(self.headers.items())):
            self._json(401, {"erro": "Sessão expirada. Entre novamente."})
            return
        query = parse_qs(urlparse(self.path).query)
        agora = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3)))
        try:
            ano = int(query.get("ano", [agora.year])[0])
            mes = int(query.get("mes", [agora.month])[0])
            if not (1 <= mes <= 12) or not (1 <= ano <= 9998):
                raise ValueError
        except (TypeError, ValueError, IndexError):
            self._json(400, {"erro": "Informe ano e mês válidos."})
            return
        try:
            self._json(200, buscar_agenda(ano, mes))
        except coletor.ErroAgenda as exc:
            self._json(502, {"erro": str(exc)})
        except Exception:
            self._json(500, {"erro": "Não foi possível consultar a agenda."})
