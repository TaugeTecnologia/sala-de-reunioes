"""Exporta setembro diretamente das agendas das salas de reunião.

Uso: python trazer-agenda-de-setembro.py --ano 2026
Nova autorização: python trazer-agenda-de-setembro.py --autorizar --ano 2026
Veja README-agenda-setembro.md para permissões e delegação de domínio.
"""

import argparse
import json
import random
import re
import sys
import time
import unicodedata
import webbrowser
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from urllib.parse import quote

import requests
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials


PASTA = Path(__file__).resolve().parent
ESCOPO_USUARIOS = "https://www.googleapis.com/auth/admin.directory.user.readonly"
ESCOPO_EVENTOS = "https://www.googleapis.com/auth/calendar.events.readonly"
ESCOPOS = [ESCOPO_EVENTOS]
FUSO = timezone(timedelta(hours=-3))
URL_USUARIOS = "https://admin.googleapis.com/admin/directory/v1/users"
URL_CALENDAR = "https://www.googleapis.com/calendar/v3/calendars"
TOKEN_NOVO = PASTA / "token-agenda-setembro.json"
SALA_PADRAO = {
    "email": "c_1889c407qaa76h6vjchtl29n5u27e@resource.calendar.google.com",
    "nome": "TAUGE CENTRAL-9-Sala de reuniões (8)",
}


class ErroAgenda(Exception):
    """Erro que pode ser apresentado sem expor credenciais."""


def argumentos():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ano", type=int, default=2026, help="Ano de setembro (padrão: 2026).")
    parser.add_argument("--token", type=Path, help="Token OAuth existente; relativo ao terminal.")
    parser.add_argument("--autorizar", action="store_true", help="Abre o login e salva um token separado.")
    parser.add_argument("--client-secret", type=Path, help="JSON OAuth usado com --autorizar.")
    parser.add_argument("--conta-servico", type=Path, help="JSON de service account com delegação de domínio.")
    parser.add_argument("--admin", help="Conta com acesso à sala a representar (service account).")
    parser.add_argument("--saida", type=Path, default=PASTA / "exportacoes", help="Pasta dos arquivos JSON e da lista de eventos em Markdown.")
    parser.add_argument("--sala", action="append", help="E-mail da agenda da sala (pode repetir), ou nome da sala padrão TAUGE CENTRAL.")
    parser.add_argument("--reprocessar", type=Path, help="Filtra um JSON já exportado, sem conectar ao Google.")
    args = parser.parse_args()
    if not 1 <= args.ano <= 9999:
        parser.error("--ano deve estar entre 1 e 9999.")
    if args.conta_servico and (args.autorizar or args.token or args.client_secret):
        parser.error("--conta-servico não pode ser combinado com as opções OAuth.")
    if bool(args.conta_servico) != bool(args.admin):
        parser.error("Use --conta-servico e --admin juntos.")
    if args.autorizar and args.token:
        parser.error("--autorizar sempre salva em token-agenda-setembro.json; não use --token junto.")
    if args.client_secret and not args.autorizar:
        parser.error("--client-secret exige --autorizar.")
    if args.sala and any(not valor.strip() for valor in args.sala):
        parser.error("--sala não pode ser vazio.")
    if args.reprocessar and (args.autorizar or args.token or args.conta_servico or args.client_secret):
        parser.error("--reprocessar não usa opções de autenticação.")
    return args


def periodo_setembro(ano):
    """Intervalo com sobreposição ao mês, no horário de Brasília UTC-03:00."""
    return (
        datetime(ano, 9, 1, tzinfo=FUSO).isoformat(),
        datetime(ano, 10, 1, tzinfo=FUSO).isoformat(),
    )


def validar_escopos(creds):
    # Não passar SCOPES ao carregar o arquivo: isso não concede novas permissões.
    escopos = set(creds.granted_scopes or creds.scopes or [])
    faltantes = []
    if not escopos.intersection({
        ESCOPO_EVENTOS, "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar",
    }):
        faltantes.append(ESCOPO_EVENTOS)
    if faltantes:
        raise ErroAgenda(
            "O token não registra os escopos necessários: " + ", ".join(faltantes)
            + ". Execute este script com --autorizar e entre com uma conta com acesso à sala. "
            "Alterar SCOPES no código ou promover a conta não atualiza um token já emitido."
        )


def carregar_credenciais(args):
    if args.conta_servico:
        base = service_account.Credentials.from_service_account_file(str(args.conta_servico))
        delegada = base.with_scopes([ESCOPO_EVENTOS]).with_subject(args.admin)
        return delegada, base

    if args.autorizar:
        from google_auth_oauthlib.flow import InstalledAppFlow, WSGITimeoutError
        from oauthlib.oauth2 import OAuth2Error

        segredo = args.client_secret
        if segredo is None:
            candidatos = sorted(PASTA.glob("client_secret*.json"))
            if not candidatos and (PASTA / "credentials.json").is_file():
                candidatos = [PASTA / "credentials.json"]
            if len(candidatos) != 1:
                raise ErroAgenda("Informe --client-secret com o JSON OAuth da aplicação.")
            segredo = candidatos[0]
        flow = InstalledAppFlow.from_client_secrets_file(str(segredo), ESCOPOS)
        try:
            creds = flow.run_local_server(port=0, prompt="consent", timeout_seconds=300)
        except WSGITimeoutError:
            raise ErroAgenda("O login não foi concluído em cinco minutos. Execute novamente com --autorizar.") from None
        except (OAuth2Error, requests.RequestException, webbrowser.Error):
            raise ErroAgenda("Não foi possível concluir o login. Confira o consentimento e execute novamente com --autorizar.") from None
        validar_escopos(creds)
        TOKEN_NOVO.write_text(creds.to_json(), encoding="utf-8")
        print(f"Autorização salva em {TOKEN_NOVO.name}.")
    else:
        caminho = args.token or (TOKEN_NOVO if TOKEN_NOVO.is_file() else PASTA / "token.json")
        if not caminho.is_file():
            raise ErroAgenda("Token não encontrado. Execute com --autorizar ou informe --token.")
        creds = Credentials.from_authorized_user_file(str(caminho))
        validar_escopos(creds)
    # AuthorizedSession renova tokens expirados usando refresh_token, em memória.
    return creds, None


def buscar_json(sessao, url, params):
    """Somente GET; repete falhas transitórias, sem imprimir token ou cabeçalhos."""
    for tentativa in range(5):
        try:
            resposta = sessao.get(url, params=params, timeout=30)
        except GoogleAuthError:
            raise ErroAgenda(
                "Falha na autenticação/renovação. Em OAuth, execute --autorizar; "
                "em service account, confira a delegação, os escopos e o usuário representado."
            ) from None
        except requests.RequestException:
            if tentativa == 4:
                raise ErroAgenda("Falha de rede após 5 tentativas.") from None
            time.sleep(2**tentativa + random.random())
            continue
        try:
            dados = resposta.json()
        except ValueError:
            dados = {}
        if not isinstance(dados, dict):
            dados = {}
        if resposta.status_code == 200:
            if not dados:
                raise ErroAgenda("O Google retornou uma resposta vazia ou inválida.")
            return dados
        erro = dados.get("error", {})
        motivos = {
            item.get("reason") for item in erro.get("errors", [])
            if isinstance(item, dict)
        } if isinstance(erro, dict) else set()
        if isinstance(erro, dict):
            motivos.update(
                item.get("reason") for item in erro.get("details", [])
                if isinstance(item, dict)
            )
        transitorio = resposta.status_code in {429, 500, 502, 503, 504} or (
            resposta.status_code == 403
            and bool(motivos.intersection({"rateLimitExceeded", "userRateLimitExceeded"}))
        )
        if transitorio and tentativa < 4:
            time.sleep(2**tentativa + random.random())
            continue
        dicas = {
            400: "Confira o customer, o período e os parâmetros da consulta.",
            401: "Autorize novamente o token ou confira a delegação da service account.",
            403: "Confira o escopo Calendar, a Google Calendar API e o acesso da conta à agenda da sala.",
            404: "Agenda não encontrada ou não acessível à conta autenticada.",
            429: "Cota excedida; tente novamente mais tarde.",
        }
        dica = dicas.get(resposta.status_code, "Falha na API Google.")
        if resposta.status_code == 403:
            if motivos.intersection({"accessNotConfigured", "SERVICE_DISABLED"}):
                api = "Admin SDK API" if url == URL_USUARIOS else "Google Calendar API"
                dica = f"Ative {api} no projeto Google Cloud que emitiu as credenciais OAuth."
            elif motivos.intersection({"insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}):
                dica = "O token não tem os escopos necessários para esta consulta. Execute com --autorizar."
            elif url == URL_USUARIOS and "forbidden" in motivos:
                dica = (
                    "O Google recusou o acesso ao diretório de usuários. Confira se o token foi "
                    "autorizado pela conta administradora correta do Google Workspace e se ela tem "
                    "Usuários > Ler para todas as unidades organizacionais no Google Admin. "
                    "Ter escopo OAuth ou ser administrador do projeto Google Cloud não concede esse privilégio. "
                    "Se o login foi feito com outra conta, execute --autorizar e selecione a conta correta."
                )
        # Mostra somente identificadores de erro, nunca cabeçalhos, tokens ou o corpo completo.
        codigos = sorted(m for m in motivos if isinstance(m, str) and m.isidentifier() and len(m) < 80)
        detalhe = f" Motivo Google: {', '.join(codigos)}." if codigos else ""
        raise ErroAgenda(f"HTTP {resposta.status_code}.{detalhe} {dica}")


def paginas(sessao, url, params):
    consulta = dict(params)
    while True:
        pagina = buscar_json(sessao, url, consulta)
        yield pagina
        proxima = pagina.get("nextPageToken")
        if not proxima:
            break
        consulta["pageToken"] = proxima


def listar_usuarios(sessao, customer):
    usuarios = []
    for pagina in paginas(sessao, URL_USUARIOS, {
        "customer": customer,
        "maxResults": 500,
        "orderBy": "email",
        "projection": "basic",
        "viewType": "admin_view",
        "fields": "nextPageToken,users(primaryEmail,name/fullName,suspended,archived)",
    }):
        usuarios.extend(pagina.get("users", []))
    return usuarios


def coletar_agenda(sessao, usuario, inicio, fim, representar=False):
    email = usuario["primaryEmail"]
    resultado = {
        "email": email,
        "nome": usuario.get("name", {}).get("fullName", ""),
        "suspenso": usuario.get("suspended", False),
        "arquivado": usuario.get("archived", False),
        "calendar_id": email,
        "status": "ok",
        "access_role": None,
        "eventos": [],
    }
    calendar_id = "primary" if representar else email
    url = f"{URL_CALENDAR}/{quote(calendar_id, safe='')}/events"
    try:
        for pagina in paginas(sessao, url, {
            "timeMin": inicio,
            "timeMax": fim,
            "timeZone": "America/Fortaleza",  # UTC-03:00; sem depender de tzdata no Windows.
            "singleEvents": "true",
            "orderBy": "startTime",
            "showDeleted": "false",
            "showHiddenInvitations": "true",
            "maxResults": 2500,
        }):
            resultado["access_role"] = pagina.get("accessRole", resultado["access_role"])
            resultado["eventos"].extend(pagina.get("items", []))
        if resultado["access_role"] not in {"owner", "writer"}:
            resultado["status"] = "acesso_limitado"
            resultado["aviso"] = "A API pode ocultar detalhes de eventos privados ou mostrar somente disponibilidade."
    except ErroAgenda as exc:
        resultado["status"] = "erro"
        resultado["erro"] = str(exc)
        # Eventos de páginas anteriores são preservados, com status de erro.
    return resultado


def salvar_json(caminho, dados):
    temporario = caminho.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    temporario.replace(caminho)


def texto_markdown(valor):
    """Mantém os textos do evento dentro da célula, sem interpretar HTML/Markdown."""
    texto = escape(" ".join(str(valor if valor is not None else "").split()))
    for caractere in ("\\", "|", "`", "*", "_", "[", "]"):
        texto = texto.replace(caractere, "\\" + caractere)
    return texto or "—"


def instante_evento(campo):
    valor = campo.get("dateTime") or campo.get("date")
    if not valor:
        return None
    try:
        instante = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        return None
    if instante.tzinfo is None:
        instante = instante.replace(tzinfo=FUSO)
    return instante.astimezone(FUSO)


def data_legivel(campo, fim=False):
    instante = instante_evento(campo)
    if instante is None:
        return "Não informado pela API"
    if "date" in campo:
        # No Google, o fim de eventos de dia inteiro é a primeira data não incluída.
        if fim:
            instante -= timedelta(days=1)
        return instante.strftime("%d/%m/%Y") + " (dia inteiro)"
    return instante.strftime("%d/%m/%Y %H:%M")


def normalizar_texto(valor):
    texto = unicodedata.normalize("NFKD", str(valor or "").casefold())
    return " ".join("".join(c for c in texto if not unicodedata.combining(c)).split())


def resolver_salas(valores=None):
    """Usa o ID já identificado do recurso, sem listar contas da organização."""
    salas = {}
    for valor in valores or [SALA_PADRAO["email"]]:
        texto = valor.strip()
        if normalizar_texto(texto) in {normalizar_texto(SALA_PADRAO["nome"]), "sala de reuniao", "sala de reunioes"}:
            texto = SALA_PADRAO["email"]
        if "@" not in texto or any(c.isspace() for c in texto):
            raise ErroAgenda("Para outra sala, informe --sala com o e-mail/ID da agenda dela no Google Calendar.")
        email = texto.casefold()
        salas[email] = {"email": email, "nome": SALA_PADRAO["nome"] if email == SALA_PADRAO["email"] else email}
    return list(salas.values())


def agendas_relatorio(relatorio):
    # Aceita exportações antigas apenas para permitir reprocessá-las com o novo filtro.
    return relatorio.get("agendas", relatorio.get("usuarios", []))


def corresponde_sala(valor, termos):
    texto = normalizar_texto(valor)
    return any(re.search(r"(?<!\w)" + re.escape(termo) + r"(?!\w)", texto) for termo in termos)


def eh_recurso(convidado):
    return bool(convidado.get("resource")) or convidado.get("email", "").casefold().endswith("@resource.calendar.google.com")


def chave_ocorrencia(evento, email, indice):
    """UID entre agendas; início ORIGINAL distingue instâncias, inclusive remarcadas."""
    uid = evento.get("iCalUID")
    if not uid:
        # IDs só são garantidos dentro da agenda. Nunca juntar apenas por título/horário.
        return ("agenda", email.casefold(), evento.get("id") or str(indice))
    campo = evento.get("originalStartTime")
    if not campo and evento.get("recurringEventId"):
        campo = evento.get("start", {})
    if not campo:
        return ("uid", uid, "unico")
    if campo.get("date"):
        return ("uid", uid, "dia:" + campo["date"])
    instante = instante_evento(campo)
    return ("uid", uid, instante.isoformat() if instante else json.dumps(campo, sort_keys=True))


def prioridade_copia(copia):
    email, evento = copia
    organizador = evento.get("organizer", {})
    propria = email.casefold() == organizador.get("email", "").casefold() or organizador.get("self", False)
    visivel = bool(evento.get("summary") or "attendees" in evento or evento.get("location") or evento.get("status") == "cancelled")
    atualizado = instante_evento({"dateTime": evento.get("updated")}) or datetime.min.replace(tzinfo=FUSO)
    return (visivel, propria, atualizado, not evento.get("attendeesOmitted", False), len(evento.get("attendees", [])))


RESPOSTAS = {"accepted": "aceitou", "tentative": "talvez", "needsAction": "sem resposta", "declined": "recusou"}


def dados_participantes(evento):
    """Conta a lista de uma cópia, sem somar listas das agendas nem contar recursos."""
    pessoas = {}
    for indice, convidado in enumerate(evento.get("attendees", [])):
        if eh_recurso(convidado):
            continue
        chave = convidado.get("email", "").casefold() or convidado.get("id") or f"sem-identificador-{indice}"
        if chave in pessoas:
            continue
        pessoas[chave] = {
            "nome": convidado.get("displayName"), "email": convidado.get("email"),
            "resposta": convidado.get("responseStatus", "nao_informada"),
            "opcional": convidado.get("optional", False),
            "convidados_adicionais": max(0, convidado.get("additionalGuests", 0)),
        }
    lista = sorted(pessoas.values(), key=lambda item: (item["email"] or item["nome"] or "").casefold())
    motivos = []
    if "attendees" not in evento:
        motivos.append("Lista de convidados não informada pela API.")
    if evento.get("attendeesOmitted"):
        motivos.append("O Google sinalizou convidados omitidos.")
    if evento.get("guestsCanSeeOtherGuests") is False and not evento.get("organizer", {}).get("self"):
        motivos.append("A visualização de outros convidados está restrita nesta cópia.")
    if any(a.get("asyncOperation") for a in evento.get("attendees", [])):
        motivos.append("A expansão de convidados ainda está em processamento.")
    por_resposta = Counter()
    for pessoa in lista:
        por_resposta[pessoa["resposta"]] += 1 + pessoa["convidados_adicionais"]
    conhecidos = sum(por_resposta.values())
    return {
        "lista": lista, "lista_possivelmente_incompleta": bool(motivos), "avisos": motivos,
        "convidados_identificados": len(lista),
        "convidados_adicionais": sum(p["convidados_adicionais"] for p in lista),
        "pessoas_convidadas": None if motivos else conhecidos,
        "pessoas_observadas_incluindo_adicionais": conhecidos,
        "aceites_observados": por_resposta["accepted"],
        "recusas_observadas": por_resposta["declined"],
        "talvez_observados": por_resposta["tentative"],
        "sem_resposta_observados": por_resposta["needsAction"],
        "resposta_desconhecida": sum(n for r, n in por_resposta.items() if r not in RESPOSTAS),
        "pessoas_presenciais": None,
    }


def classificar_sala(evento, termos, recursos_conhecidos, sala_origem=None):
    recursos = []
    for convidado in evento.get("attendees", []):
        email = convidado.get("email", "").casefold()
        if eh_recurso(convidado) and (email in recursos_conhecidos
                or corresponde_sala(convidado.get("displayName"), termos)
                or corresponde_sala(email, termos)):
            recursos.append({"nome": convidado.get("displayName") or recursos_conhecidos.get(email),
                             "email": email, "resposta": convidado.get("responseStatus", "nao_informada")})
    local = corresponde_sala(evento.get("location"), termos)
    if evento.get("status") == "cancelled":
        return False, "cancelado", "Evento cancelado.", recursos
    if evento.get("eventType", "default") != "default":
        return False, "tipo_nao_reuniao", "Tipo de evento: " + evento["eventType"] + ".", recursos
    if recursos:
        if all(r["resposta"] == "declined" for r in recursos):
            return False, "sala_recusou", "A sala recusou o convite; o local escrito não confirma reserva.", recursos
        if any(r["resposta"] == "accepted" for r in recursos):
            return True, "sala_aceitou", "O recurso da sala aceitou o convite.", recursos
        return True, "sala_pendente", "Sala convidada, mas sem aceite confirmado.", recursos
    if sala_origem:
        return True, "agenda_da_sala", "Evento obtido diretamente da agenda da sala.", [
            {"nome": sala_origem.get("nome"), "email": sala_origem["email"], "resposta": "nao_informada"}]
    if local:
        return True, "sala_no_local", "Sala informada no local; reserva do recurso não confirmada.", recursos
    if re.search(r"\breuniao\b|\breunioes\b", normalizar_texto(evento.get("summary"))):
        return False, "revisar_sala", "Título menciona reunião, mas não há vínculo identificado com a sala.", recursos
    return False, "sem_vinculo_sala", "Sem sala identificada no local ou nos recursos convidados.", recursos


def analisar_salas(relatorio, salas=None):
    termos = [normalizar_texto(s) for s in (salas or ["sala de reunião", "sala de reuniões"])]
    grupos = defaultdict(list)
    salas_diretas = {a["email"].casefold(): a for a in agendas_relatorio(relatorio)
                    if a.get("tipo") == "sala" and (not salas or corresponde_sala(a["email"], termos)
                                                    or corresponde_sala(a.get("nome"), termos))}
    recursos_conhecidos = {email: a.get("nome") for email, a in salas_diretas.items()}
    for usuario in agendas_relatorio(relatorio):
        for indice, evento in enumerate(usuario.get("eventos", [])):
            grupos[chave_ocorrencia(evento, usuario["email"], indice)].append((usuario["email"], evento))
            for recurso in evento.get("attendees", []):
                if eh_recurso(recurso) and (corresponde_sala(recurso.get("displayName"), termos)
                                           or corresponde_sala(recurso.get("email"), termos)):
                    recursos_conhecidos[recurso.get("email", "").casefold()] = recurso.get("displayName")
    incluidos, fora = [], []
    for chave, copias in grupos.items():
        origem, evento = max(copias, key=prioridade_copia)
        incluido, classificacao, motivo, recursos = classificar_sala(evento, termos, recursos_conhecidos, salas_diretas.get(origem.casefold()))
        inicio, fim = instante_evento(evento.get("start", {})), instante_evento(evento.get("end", {}))
        intervalo_valido = inicio is not None and fim is not None and fim > inicio
        avisos = []
        if not intervalo_valido:
            avisos.append("Início/fim ausentes ou intervalo inválido: não usar para calcular ocupação.")
        if not evento.get("iCalUID"):
            avisos.append("Sem iCalUID: não foi possível deduplicar entre agendas com segurança.")
        if evento.get("recurringEventId") and not evento.get("originalStartTime"):
            avisos.append("Recorrência sem início original: deduplicação usa o início atual.")
        # Comparar versões evita esconder divergências; não juntar listas antigas a novas.
        campos = ("start", "end", "location", "attendees", "status")
        variantes = {json.dumps({k: e.get(k) for k in campos}, sort_keys=True) for _, e in copias}
        if len(variantes) > 1:
            avisos.append("Há diferenças entre cópias. Usada uma cópia visível, preferindo a do organizador e depois a mais atualizada.")
        participantes = dados_participantes(evento)
        avisos.extend(participantes["avisos"])
        online = bool(evento.get("hangoutLink") or evento.get("conferenceData", {}).get("entryPoints"))
        transparente = evento.get("transparency") == "transparent"
        if transparente:
            avisos.append("Evento marcado como disponível (transparent); não considerar bloqueio confirmado.")
        if evento.get("status") == "tentative":
            avisos.append("O próprio evento está marcado como provisório (tentative).")
        item = {
            "chave": list(chave), "ical_uid": evento.get("iCalUID"), "id_evento": evento.get("id"),
            "nome": evento.get("summary") or "Título não informado pela API",
            "data": inicio.date().isoformat() if inicio else None,
            "inicio": inicio.isoformat() if inicio else None, "fim": fim.isoformat() if fim else None,
            "inicio_legivel": data_legivel(evento.get("start", {})),
            "fim_legivel": data_legivel(evento.get("end", {}), fim=True),
            "dia_inteiro": "date" in evento.get("start", {}), "fim_exclusivo": True,
            "duracao_minutos": (fim - inicio).total_seconds() / 60 if intervalo_valido else None,
            "criador": evento.get("creator", {}), "organizador": evento.get("organizer", {}),
            "local": evento.get("location"), "salas": recursos, "participantes": participantes,
            "descricao": evento.get("description"), "tem_conferencia_online": online,
            "modalidade": ("Sala indicada e conferência online; presença física a confirmar." if incluido and online
                           else "Sala indicada; presença física a confirmar." if incluido else "Não determinada para esta sala."),
            "classificacao": classificacao, "motivo": motivo,
            "bloqueio_confirmado": classificacao in {"sala_aceitou", "agenda_da_sala"} and intervalo_valido
                                  and not transparente and evento.get("status", "confirmed") == "confirmed",
            "agenda_copia_utilizada": origem, "copias_encontradas": len(copias),
            "agendas_origem": sorted({email for email, _ in copias}),
            "avisos": avisos,
        }
        (incluidos if incluido else fora).append(item)
    for lista in (incluidos, fora):
        lista.sort(key=lambda e: (e["inicio"] or "9999", e["nome"].casefold(), e["chave"]))
    total_copias = sum(len(copias) for copias in grupos.values())
    return {
        "filtros_sala": salas or ["sala de reunião", "sala de reuniões"],
        "recursos_identificados": recursos_conhecidos,
        "resumo": {"registros_originais": total_copias, "eventos_unicos": len(grupos),
                   "copias_duplicadas_agrupadas": total_copias - len(grupos),
                   "eventos_na_sala": len(incluidos), "eventos_fora_do_filtro": len(fora),
                   "titulos_reuniao_para_revisar": sum(e["classificacao"] == "revisar_sala" for e in fora),
                   "bloqueios_confirmados": sum(e["bloqueio_confirmado"] for e in incluidos)},
        "motivos_exclusao": dict(Counter(e["classificacao"] for e in fora)),
        "eventos_na_sala": incluidos, "fora_do_filtro": fora,
    }


def pessoa_legivel(pessoa):
    return " - ".join(str(v) for v in (pessoa.get("displayName") or pessoa.get("nome"), pessoa.get("email")) if v) or "Não informado pela API"


def contagem_legivel(participantes):
    total = participantes["pessoas_convidadas"]
    return str(total) if total is not None else f"desconhecido ({participantes['pessoas_observadas_incluindo_adicionais']} observados)"


def exportacao_da_sala(relatorio, gestao):
    """Salva somente ocorrências incluídas e os e-mails vinculados a elas."""
    chaves = {tuple(e["chave"]) for e in gestao["eventos_na_sala"]}
    agendas = []
    for origem in agendas_relatorio(relatorio):
        eventos = [e for i, e in enumerate(origem.get("eventos", []))
                   if chave_ocorrencia(e, origem["email"], i) in chaves]
        if eventos or origem.get("tipo") == "sala":
            agendas.append({**origem, "eventos": eventos})
    emails = set()
    for evento in gestao["eventos_na_sala"]:
        for pessoa in [evento["criador"], evento["organizador"], *evento["participantes"]["lista"]]:
            if pessoa.get("email") and not eh_recurso(pessoa):
                emails.add(pessoa["email"].casefold())
    resultado = {k: v for k, v in relatorio.items()
                 if k not in {"usuarios", "agendas", "gestao_sala", "customer", "total_usuarios", "completo_para_usuarios_listados"}}
    resultado["agendas"] = agendas
    resultado["emails_vinculados"] = sorted(emails)
    resultado["gestao_sala"] = {k: v for k, v in gestao.items() if k not in {"fora_do_filtro", "motivos_exclusao"}}
    resultado["formato"] = "eventos_das_salas_v2"
    return resultado


def salvar_gestao_sala(caminho_json, relatorio, salas=None):
    gestao = analisar_salas(relatorio, salas)
    relatorio["gestao_sala"] = gestao
    resumo = gestao["resumo"]
    caminho = caminho_json.with_name(caminho_json.stem + "-salas.md")
    linhas = [f"# Administração da sala — setembro de {relatorio['ano']}", "",
              f"Horários UTC-03:00. Filtro: {texto_markdown(', '.join(gestao['filtros_sala']))}.", "",
              f"**{resumo['eventos_na_sala']} eventos únicos com sala indicada**, "
              f"{resumo['bloqueios_confirmados']} com bloqueio confirmado.", "",
              ("Consulta direta às agendas das salas selecionadas. A permissão da conta pode limitar detalhes de eventos privados."
               if relatorio.get("origem_coleta") == "agendas_das_salas" else
               "Reprocessamento de uma coleta anterior. A cobertura e as restrições de acesso daquela coleta continuam válidas."), "",
              "Convidados são contados uma vez por e-mail, excluindo recursos e incluindo acompanhantes declarados. "
              "Aceites são respostas ao convite, não presença física. Criador e organizador são informados separadamente; "
              "só entram na contagem se constarem como convidados. Listas omitidas ou restritas têm total desconhecido.", "",
              "A mesma ocorrência é agrupada por iCalUID e início original da recorrência. "
              "O fim é exclusivo no JSON; em eventos de dia inteiro o texto mostra o último dia incluído.", "",
              f"Dados dos eventos da sala: [{texto_markdown(caminho_json.name)}]({quote(caminho_json.name)}).", "",
              "## Eventos com sala indicada", "",
              "| Evento | Início | Fim | Convidados | Aceites | Situação da sala |",
              "| --- | --- | --- | --- | ---: | --- |"]
    print(f"\nSala de reunião: {resumo['eventos_na_sala']} eventos únicos.")
    for evento in gestao["eventos_na_sala"]:
        p = evento["participantes"]
        celulas = [evento["nome"], evento["inicio_legivel"], evento["fim_legivel"], contagem_legivel(p), p["aceites_observados"], evento["motivo"]]
        linhas.append("| " + " | ".join(texto_markdown(v) for v in celulas) + " |")
        print(f"\nEvento: {' '.join(evento['nome'].split())}\n  Início: {evento['inicio_legivel']} | Fim: {evento['fim_legivel']}")
        print(f"  Convidados: {contagem_legivel(p)} | Aceites: {p['aceites_observados']} | Recusas: {p['recusas_observadas']}")
        print(f"  Criador: {pessoa_legivel(evento['criador'])} | Organizador: {pessoa_legivel(evento['organizador'])}")
        print(f"  Sala: {evento['motivo']} | Bloqueio confirmado: {'sim' if evento['bloqueio_confirmado'] else 'não'}")
        print("  Participantes: " + ("; ".join(pessoa_legivel(a) + " (" + RESPOSTAS.get(a["resposta"], "resposta desconhecida") + ")" for a in p["lista"]) or "não informados"))
    if not gestao["eventos_na_sala"]:
        linhas.append("\nNenhum evento com vínculo identificado com a sala.")
        print("Nenhum evento com vínculo identificado com a sala.")
    for evento in gestao["eventos_na_sala"]:
        p = evento["participantes"]
        linhas.extend(["", "### " + texto_markdown(evento["nome"]), "",
                       f"Início: {evento['inicio_legivel']}. Fim: {evento['fim_legivel']}.", "",
                       f"Criador: {texto_markdown(pessoa_legivel(evento['criador']))}. "
                       f"Organizador: {texto_markdown(pessoa_legivel(evento['organizador']))}.", "",
                       f"Local: {texto_markdown(evento['local'])}. "
                       f"Recursos: {texto_markdown('; '.join(pessoa_legivel(r) for r in evento['salas']))}.", "",
                       f"Situação: {evento['motivo']} Bloqueio confirmado: {'sim' if evento['bloqueio_confirmado'] else 'não'}.", "",
                       evento["modalidade"], "", "Descrição/pauta: " + texto_markdown(evento["descricao"]), "",
                       f"Convidados: {contagem_legivel(p)}. Aceites: {p['aceites_observados']}; "
                       f"talvez: {p['talvez_observados']}; sem resposta: {p['sem_resposta_observados']}; recusas: {p['recusas_observadas']}.", "",
                       "| Participante | Resposta | Opcional | Acompanhantes |", "| --- | --- | --- | ---: |"])
        for pessoa in p["lista"]:
            celulas = [pessoa_legivel(pessoa), RESPOSTAS.get(pessoa["resposta"], "resposta desconhecida"),
                       "sim" if pessoa["opcional"] else "não", pessoa["convidados_adicionais"]]
            linhas.append("| " + " | ".join(texto_markdown(v) for v in celulas) + " |")
        linhas.extend(["", f"Cópias agrupadas: {evento['copias_encontradas']}; cópia utilizada: {texto_markdown(evento['agenda_copia_utilizada'])}.", "",
                       "Agendas de origem: " + texto_markdown(", ".join(evento["agendas_origem"])) + "."])
        for aviso in evento["avisos"]:
            linhas.extend(["", "Atenção: " + texto_markdown(aviso)])
    caminho.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    salvar_json(caminho_json, exportacao_da_sala(relatorio, gestao))
    print(f"\nRelatório dos eventos da sala: {caminho}")
    return caminho


def imprimir_eventos(usuario):
    """Exibe no terminal os eventos de uma agenda em ordem de início."""
    print(f"\nAgenda: {usuario['email']} | Horários em UTC-03:00")
    for chave in ("erro", "aviso"):
        if usuario.get(chave):
            print(f"Atenção: {usuario[chave]}")
    if not usuario["eventos"]:
        print("Nenhum evento retornado pela API para esta agenda.\n")
        return
    eventos = sorted(usuario["eventos"], key=lambda evento:
                     instante_evento(evento.get("start", {})) or datetime.max.replace(tzinfo=FUSO))
    for evento in eventos:
        titulo = " ".join((evento.get("summary") or "Título não informado pela API").split())
        print(f"\n  Evento: {titulo}")
        print(f"  Início: {data_legivel(evento.get('start', {}))}")
        print(f"  Fim:    {data_legivel(evento.get('end', {}), fim=True)}")
    print()


def salvar_lista_eventos(caminho_json, relatorio):
    """Lista cada cópia de evento por agenda, sem deduplicar nem ocultar pendências."""
    usuarios = sorted(relatorio["usuarios"], key=lambda item: item["email"].casefold())
    total = sum(len(usuario["eventos"]) for usuario in usuarios)
    limitados = sum(usuario["status"] == "acesso_limitado" for usuario in usuarios)
    erros = sum(usuario["status"] == "erro" for usuario in usuarios)
    linhas = [
        f"# Eventos de setembro de {relatorio['ano']} por e-mail corporativo", "",
        f"Período: 01/09/{relatorio['ano']} a 30/09/{relatorio['ano']}, UTC-03:00.", "",
        f"Agendas consultadas: **{len(usuarios)}** de **{relatorio['total_usuarios']}** usuários listados. "
        f"Registros de eventos: **{total}**. Agendas com acesso limitado: **{limitados}**. "
        f"Agendas com erro: **{erros}**.", "",
        "Coleta finalizada: " + ("sim." if relatorio.get("coleta_finalizada") else "não; resultado parcial."), "",
        "Cada seção corresponde à agenda principal de um e-mail. A mesma reunião pode aparecer "
        "nas agendas de várias pessoas. Recorrências aparecem por ocorrência. "
        "Inclui eventos que atravessam o início ou o fim do mês, com suas datas originais. "
        "Em eventos de dia inteiro, a coluna Fim mostra o último dia incluído.", "",
        "Acesso limitado pode ocultar detalhes de eventos privados. Campos ausentes não são "
        "reconstruídos. Salas, agendas secundárias, usuários excluídos e eventos cancelados "
        "não fazem parte desta consulta.", "",
        f"Dados completos retornados pelo Google: [{texto_markdown(caminho_json.name)}]({quote(caminho_json.name)}).", "",
        "## Resumo por e-mail", "",
        "| E-mail | Eventos | Resultado | Papel de acesso |",
        "| --- | ---: | --- | --- |",
    ]
    for usuario in usuarios:
        celulas = [usuario["email"], str(len(usuario["eventos"])), usuario["status"], usuario.get("access_role")]
        linhas.append("| " + " | ".join(texto_markdown(valor) for valor in celulas) + " |")
    for usuario in usuarios:
        linhas.extend(["", f"## {texto_markdown(usuario['email'])}", "",
                       f"Nome: {texto_markdown(usuario.get('nome'))}. Eventos: {len(usuario['eventos'])}.", ""])
        for chave in ("erro", "aviso"):
            if usuario.get(chave):
                linhas.extend([f"**Atenção:** {texto_markdown(usuario[chave])}", ""])
        if not usuario["eventos"]:
            mensagem = ("A consulta falhou antes de retornar eventos." if usuario["status"] == "erro"
                        else "Nenhum evento retornado pela API neste período.")
            linhas.append(mensagem)
            continue
        linhas.extend(["| Início | Fim | Evento | Organizador | Local |",
                       "| --- | --- | --- | --- | --- |"])
        eventos = sorted(usuario["eventos"], key=lambda evento:
                         instante_evento(evento.get("start", {})) or datetime.max.replace(tzinfo=FUSO))
        for evento in eventos:
            organizador = evento.get("organizer", {})
            celulas = [
                data_legivel(evento.get("start", {})),
                data_legivel(evento.get("end", {}), fim=True),
                evento.get("summary") or "Título não informado pela API",
                organizador.get("email") or organizador.get("displayName"),
                evento.get("location"),
            ]
            linhas.append("| " + " | ".join(texto_markdown(valor) for valor in celulas) + " |")
    caminho = caminho_json.with_suffix(".md")
    caminho.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    return caminho


def executar(args):
    if getattr(args, "reprocessar", None):
        relatorio = json.loads(args.reprocessar.read_text(encoding="utf-8"))
        if (not isinstance(relatorio, dict) or not isinstance(relatorio.get("agendas", relatorio.get("usuarios")), list)
                or not isinstance(relatorio.get("ano"), int) or relatorio.get("mes", 9) != 9
                or any(not isinstance(u, dict) or not u.get("email") or not isinstance(u.get("eventos"), list)
                       for u in agendas_relatorio(relatorio))):
            raise ErroAgenda("--reprocessar exige um JSON de setembro exportado por este script.")
        args.saida.mkdir(parents=True, exist_ok=True)
        identificador = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        caminho = args.saida / f"agenda-setembro-{relatorio['ano']}-{identificador}.json"
        relatorio["reprocessado_de"] = args.reprocessar.name
        relatorio["analise_em"] = datetime.now(timezone.utc).isoformat()
        print(f"Reprocessando dados de setembro de {relatorio['ano']}, coletados em {relatorio.get('gerado_em', 'data não informada')}.")
        salvar_gestao_sala(caminho, relatorio, getattr(args, "sala", None))
        parcial = not relatorio.get("coleta_finalizada") or any(u.get("status") != "ok" for u in agendas_relatorio(relatorio))
        if parcial:
            print("A coleta original tem pendências ou acesso limitado; esta análise mantém essas limitações.")
        return 2 if parcial else 0
    salas = resolver_salas(getattr(args, "sala", None))
    creds, conta_servico = carregar_credenciais(args)
    inicio, fim = periodo_setembro(args.ano)
    print(f"Período: {inicio} até {fim} (limite final exclusivo).")
    print(f"Consultando diretamente {len(salas)} agenda(s) de sala de reunião...")
    with AuthorizedSession(creds, refresh_timeout=30) as sessao:
        args.saida.mkdir(parents=True, exist_ok=True)
        identificador = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        caminho = args.saida / f"agenda-setembro-{args.ano}-{identificador}.json"
        relatorio = {
            "ano": args.ano,
            "mes": 9,
            "time_min": inicio,
            "time_max": fim,
            "fuso": "UTC-03:00",
            "gerado_em": datetime.now(timezone.utc).isoformat(),
            "modo": "delegacao_dominio" if conta_servico else "oauth_usuario",
            "origem_coleta": "agendas_das_salas",
            "escopo": "Somente as agendas das salas selecionadas; sem listar contas da organização.",
            "total_agendas": len(salas),
            "coleta_finalizada": False,
            "agendas": [],
        }
        salvar_json(caminho, relatorio)
        for indice, sala in enumerate(salas, start=1):
            resultado = coletar_agenda(sessao, {"primaryEmail": sala["email"], "name": {"fullName": sala["nome"]}}, inicio, fim)
            resultado["tipo"] = "sala"
            relatorio["agendas"].append(resultado)
            salvar_json(caminho, relatorio)
            print(f"[{indice}/{len(salas)}] {sala['nome']}: {len(resultado['eventos'])} eventos; {resultado['status']}")
            if resultado.get("erro"):
                print(f"Não foi possível consultar a sala: {resultado['erro']}")

    resultados = relatorio["agendas"]
    pendencias = sum(item["status"] != "ok" for item in resultados)
    relatorio["coleta_finalizada"] = True
    relatorio["completo_para_salas_selecionadas"] = pendencias == 0
    relatorio["resumo"] = {
        "agendas_ok": sum(item["status"] == "ok" for item in resultados),
        "agendas_com_erro": sum(item["status"] == "erro" for item in resultados),
        "agendas_com_acesso_limitado": sum(item["status"] == "acesso_limitado" for item in resultados),
        "total_eventos_por_agenda": sum(len(item["eventos"]) for item in resultados),
    }
    salvar_json(caminho, relatorio)
    print(f"Arquivo salvo: {caminho}")
    print(f"{len(resultados)} agendas consultadas; {pendencias} com erro ou acesso limitado.")
    if pendencias:
        print("Exportação parcial: consulte erro/aviso em cada sala no JSON.")
    salvar_gestao_sala(caminho, relatorio, getattr(args, "sala", None))
    return 2 if pendencias else 0


def main():
    args = argumentos()
    try:
        return executar(args)
    except ErroAgenda as exc:
        print(f"Erro: {exc}", file=sys.stderr)
    except (OSError, ValueError, GoogleAuthError):
        print("Erro ao ler/salvar arquivos ou autenticar. Confira os caminhos, o formato das credenciais e a autorização.", file=sys.stderr)
    except KeyboardInterrupt:
        print("Coleta interrompida. Consulte o JSON parcial em --saida, se já foi criado.", file=sys.stderr)
        return 130
    return 1


if __name__ == "__main__":
    sys.exit(main())
