"""Testes offline da exportação de setembro, sem credenciais ou APIs reais."""

import importlib.util
import io
import json
import tempfile
import unittest
from copy import deepcopy
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).with_name("trazer-agenda-de-setembro.py")
SPEC = importlib.util.spec_from_file_location("agenda_setembro", SCRIPT)
agenda = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agenda)


def resposta(status, dados):
    retorno = Mock(status_code=status)
    retorno.json.return_value = dados
    return retorno


def sessao_com_respostas(*respostas):
    """Copia os parâmetros antes que a paginação altere seu dicionário."""
    sessao = Mock()
    chamadas = []
    fila = iter(respostas)

    def get(url, *, params, timeout):
        chamadas.append((url, dict(params), timeout))
        return next(fila)

    sessao.get.side_effect = get
    sessao.__enter__ = Mock(return_value=sessao)
    sessao.__exit__ = Mock(return_value=False)
    return sessao, chamadas


class TestAgendaSetembro(unittest.TestCase):
    def test_directory_percorre_paginas_inclusive_vazia(self):
        primeiro = {"primaryEmail": "ana@example.test"}
        ultimo = {"primaryEmail": "bia@secundario.example.test"}
        sessao, chamadas = sessao_com_respostas(
            resposta(200, {"users": [primeiro], "nextPageToken": "p2"}),
            resposta(200, {"users": [], "nextPageToken": "p3"}),
            resposta(200, {"users": [ultimo]}),
        )

        self.assertEqual(agenda.listar_usuarios(sessao, "my_customer"), [primeiro, ultimo])
        self.assertEqual(len(chamadas), 3)
        self.assertEqual([item[1].get("pageToken") for item in chamadas], [None, "p2", "p3"])
        for url, params, timeout in chamadas:
            self.assertEqual(url, agenda.URL_USUARIOS)
            self.assertEqual(params["customer"], "my_customer")
            self.assertNotIn("domain", params)
            self.assertIn("nextPageToken", params["fields"])
            self.assertEqual(timeout, 30)

    def test_calendar_pagina_vazia_nao_encerra_coleta_e_parametros_corretos(self):
        sessao, chamadas = sessao_com_respostas(
            resposta(200, {"accessRole": "owner", "items": [{"id": "e1"}], "nextPageToken": "p2"}),
            resposta(200, {"accessRole": "owner", "items": [], "nextPageToken": "p3"}),
            resposta(200, {"accessRole": "owner", "items": [{"id": "e2"}]}),
        )
        inicio, fim = agenda.periodo_setembro(2025)
        self.assertEqual(inicio, "2025-09-01T00:00:00-03:00")
        self.assertEqual(fim, "2025-10-01T00:00:00-03:00")

        resultado = agenda.coletar_agenda(
            sessao, {"primaryEmail": "ana+agenda@example.test"}, inicio, fim
        )

        self.assertEqual(resultado["status"], "ok")
        self.assertEqual(resultado["eventos"], [{"id": "e1"}, {"id": "e2"}])
        self.assertEqual([item[1].get("pageToken") for item in chamadas], [None, "p2", "p3"])
        for url, params, _ in chamadas:
            self.assertTrue(url.endswith("/ana%2Bagenda%40example.test/events"))
            self.assertEqual(params["timeMin"], inicio)
            self.assertEqual(params["timeMax"], fim)
            self.assertEqual(params["singleEvents"], "true")
            self.assertEqual(params["orderBy"], "startTime")
            self.assertEqual(params["showHiddenInvitations"], "true")
            self.assertEqual(params["showDeleted"], "false")
            self.assertEqual(params["maxResults"], 2500)

    def test_delegacao_consulta_primary_mantendo_usuario_no_resultado(self):
        sessao, chamadas = sessao_com_respostas(resposta(200, {"accessRole": "owner", "items": []}))
        resultado = agenda.coletar_agenda(
            sessao, {"primaryEmail": "ana@example.test"},
            *agenda.periodo_setembro(2026), representar=True,
        )
        self.assertTrue(chamadas[0][0].endswith("/primary/events"))
        self.assertEqual(resultado["calendar_id"], "ana@example.test")

    def test_erro_na_segunda_pagina_preserva_eventos_anteriores(self):
        sessao, chamadas = sessao_com_respostas(
            resposta(200, {"accessRole": "owner", "items": [{"id": "preservado"}], "nextPageToken": "p2"}),
            resposta(403, {"error": {"errors": [{"reason": "forbidden"}]}}),
        )
        resultado = agenda.coletar_agenda(
            sessao, {"primaryEmail": "ana@example.test"}, *agenda.periodo_setembro(2026)
        )
        self.assertEqual(len(chamadas), 2)
        self.assertEqual(resultado["status"], "erro")
        self.assertIn("HTTP 403", resultado["erro"])
        self.assertEqual(resultado["eventos"], [{"id": "preservado"}])

    def test_http_200_reader_e_acesso_limitado(self):
        for papel in ("reader", "writerWithoutPrivateAccess", "freeBusyReader"):
            with self.subTest(papel=papel):
                sessao, _ = sessao_com_respostas(
                    resposta(200, {"accessRole": papel, "items": [{"id": "visivel"}]})
                )
                resultado = agenda.coletar_agenda(
                    sessao, {"primaryEmail": "ana@example.test"}, *agenda.periodo_setembro(2026)
                )
                self.assertEqual(resultado["status"], "acesso_limitado")
                self.assertEqual(resultado["access_role"], papel)
                self.assertTrue(resultado["aviso"])
                self.assertEqual(resultado["eventos"], [{"id": "visivel"}])

    def test_token_sem_calendar_rejeitado_sem_ler_arquivo_real(self):
        token = Mock()
        token.is_file.return_value = True
        token.__str__ = Mock(return_value="token-ficticio.json")
        args = SimpleNamespace(conta_servico=None, autorizar=False, token=token)
        creds = SimpleNamespace(granted_scopes=None, scopes=[agenda.ESCOPO_USUARIOS])
        with patch.object(agenda.Credentials, "from_authorized_user_file", return_value=creds) as carregar:
            with self.assertRaisesRegex(agenda.ErroAgenda, "calendar.events.readonly"):
                agenda.carregar_credenciais(args)
        carregar.assert_called_once_with("token-ficticio.json")

    def test_escopos_amplos_existentes_sao_aceitos(self):
        for diretorio in (agenda.ESCOPO_USUARIOS, "https://www.googleapis.com/auth/admin.directory.user"):
            for calendar in ("calendar", "calendar.readonly", "calendar.events", "calendar.events.readonly"):
                with self.subTest(diretorio=diretorio, calendar=calendar):
                    creds = SimpleNamespace(
                        granted_scopes=None,
                        scopes=[diretorio, "https://www.googleapis.com/auth/" + calendar],
                    )
                    agenda.validar_escopos(creds)

    def test_escopos_concedidos_prevalecem_sobre_escopos_solicitados(self):
        creds = SimpleNamespace(granted_scopes=[agenda.ESCOPO_USUARIOS], scopes=agenda.ESCOPOS)
        with self.assertRaises(agenda.ErroAgenda):
            agenda.validar_escopos(creds)

    def verificar_falha_login_preserva_token(self, erro, mensagem):
        with tempfile.TemporaryDirectory(prefix="teste-login-agenda-") as pasta:
            token = Path(pasta) / "token-ficticio.json"
            conteudo_original = b'{"teste": "conteudo-anterior-sem-credenciais"}'
            token.write_bytes(conteudo_original)
            segredo = Path(pasta) / "client-secret-ficticio.json"
            args = SimpleNamespace(conta_servico=None, autorizar=True, client_secret=segredo)
            flow = Mock()
            flow.run_local_server.side_effect = erro
            with (
                patch.object(agenda, "TOKEN_NOVO", token),
                patch("google_auth_oauthlib.flow.InstalledAppFlow.from_client_secrets_file", return_value=flow) as criar_flow,
            ):
                with self.assertRaisesRegex(agenda.ErroAgenda, mensagem):
                    agenda.carregar_credenciais(args)
            self.assertEqual(token.read_bytes(), conteudo_original)
            criar_flow.assert_called_once_with(str(segredo), agenda.ESCOPOS)
            flow.run_local_server.assert_called_once_with(port=0, prompt="consent", timeout_seconds=300)

    def test_recusa_consentimento_preserva_token_existente(self):
        from oauthlib.oauth2 import OAuth2Error

        self.verificar_falha_login_preserva_token(
            OAuth2Error(description="Consentimento recusado no teste."), "consentimento"
        )

    def test_timeout_login_preserva_token_existente(self):
        from google_auth_oauthlib.flow import WSGITimeoutError

        self.verificar_falha_login_preserva_token(WSGITimeoutError(), "cinco minutos")

    def test_403_transitorio_repete_e_403_permissao_nao_repete(self):
        for motivo in ("rateLimitExceeded", "userRateLimitExceeded", "forbidden", "insufficientPermissions"):
            with self.subTest(motivo=motivo):
                sessao, chamadas = sessao_com_respostas(
                    resposta(403, {"error": {"errors": [{"reason": motivo}]}}),
                    resposta(200, {"items": [{"id": "ok"}]}),
                )
                with patch.object(agenda.time, "sleep") as dormir, patch.object(agenda.random, "random", return_value=0):
                    if motivo in {"rateLimitExceeded", "userRateLimitExceeded"}:
                        self.assertEqual(
                            agenda.buscar_json(sessao, "https://example.test/events", {}),
                            {"items": [{"id": "ok"}]},
                        )
                        self.assertEqual(len(chamadas), 2)
                        dormir.assert_called_once_with(1)
                    else:
                        with self.assertRaisesRegex(agenda.ErroAgenda, "HTTP 403"):
                            agenda.buscar_json(sessao, "https://example.test/events", {})
                        self.assertEqual(len(chamadas), 1)
                        dormir.assert_not_called()

    def test_403_directory_orienta_privilegio_sem_confundir_com_calendar(self):
        sessao, _ = sessao_com_respostas(resposta(403, {
            "error": {"errors": [{"reason": "forbidden"}], "message": "SEGREDO-NAO-IMPRIMIR"}
        }))
        with self.assertRaises(agenda.ErroAgenda) as contexto:
            agenda.listar_usuarios(sessao, "my_customer")
        mensagem = str(contexto.exception)
        self.assertIn("Usuários > Ler", mensagem)
        self.assertIn("conta administradora correta", mensagem)
        self.assertIn("Motivo Google: forbidden", mensagem)
        self.assertNotIn("Calendar > Gerenciar", mensagem)
        self.assertNotIn("SEGREDO-NAO-IMPRIMIR", mensagem)

    def test_403_api_desativada_identifica_api_correspondente(self):
        for url, api in ((agenda.URL_USUARIOS, "Admin SDK API"),
                         (agenda.URL_CALENDAR + "/primary/events", "Google Calendar API")):
            with self.subTest(api=api):
                sessao, _ = sessao_com_respostas(resposta(403, {
                    "error": {"details": [{"reason": "SERVICE_DISABLED"}]}
                }))
                with self.assertRaisesRegex(agenda.ErroAgenda, "Ative " + api):
                    agenda.buscar_json(sessao, url, {})

    def test_403_escopo_insuficiente_orienta_novo_consentimento(self):
        sessao, _ = sessao_com_respostas(resposta(403, {
            "error": {"details": [{"reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}
        }))
        with self.assertRaisesRegex(agenda.ErroAgenda, "Execute com --autorizar"):
            agenda.buscar_json(sessao, agenda.URL_USUARIOS, {})

    def test_datas_legiveis_respeitam_fuso_e_fim_exclusivo_de_dia_inteiro(self):
        self.assertEqual(agenda.data_legivel({"dateTime": "2026-09-01T01:00:00Z"}), "31/08/2026 22:00")
        self.assertEqual(agenda.data_legivel({"date": "2026-09-30"}), "30/09/2026 (dia inteiro)")
        self.assertEqual(agenda.data_legivel({"date": "2026-10-01"}, fim=True), "30/09/2026 (dia inteiro)")
        self.assertEqual(agenda.data_legivel({}), "Não informado pela API")

    def test_lista_preserva_copias_campos_ocultos_e_avisos_em_ordem(self):
        evento = {"summary": "Reunião | <script>alert(1)</script>",
                  "start": {"dateTime": "2026-09-01T08:00:00-03:00"},
                  "end": {"dateTime": "2026-09-01T09:00:00-03:00"}}
        oculto = {"start": {"dateTime": "2026-09-02T08:00:00-03:00"},
                  "end": {"dateTime": "2026-09-02T09:00:00-03:00"}}
        relatorio = {"ano": 2026, "total_usuarios": 3, "coleta_finalizada": True, "usuarios": [
            {"email": "bia@example.test", "status": "acesso_limitado", "access_role": "reader",
             "aviso": "Privados podem estar ocultos", "eventos": [oculto, evento]},
            {"email": "ana@example.test", "status": "ok", "access_role": "owner", "eventos": [evento]},
            {"email": "caio@example.test", "status": "erro", "erro": "Falha de consulta", "eventos": []},
        ]}
        with tempfile.TemporaryDirectory(prefix="teste-lista-agenda-") as pasta:
            lista = agenda.salvar_lista_eventos(Path(pasta) / "eventos.json", relatorio)
            conteudo = lista.read_text(encoding="utf-8")
        self.assertEqual(conteudo.count("Reunião"), 2)  # Uma cópia em cada agenda.
        self.assertIn("Registros de eventos: **3**", conteudo)
        self.assertIn("Título não informado pela API", conteudo)
        self.assertIn("Privados podem estar ocultos", conteudo)
        self.assertIn("A consulta falhou antes de retornar eventos.", conteudo)
        self.assertIn("[eventos.json](eventos.json)", conteudo)
        self.assertNotIn("<script>", conteudo)
        self.assertIn("\\| &lt;script&gt;", conteudo)
        self.assertLess(conteudo.index("## ana@example.test"), conteudo.index("## bia@example.test"))
        secao_bia = conteudo.split("## bia@example.test", 1)[1]
        self.assertLess(secao_bia.index("01/09/2026 08:00"), secao_bia.index("02/09/2026 08:00"))

    def test_execucao_consulta_apenas_salas_continua_apos_falha_e_retorna_2(self):
        salas = [f"{nome}@resource.calendar.google.com" for nome in ("sala1", "sala2", "sala3")]
        sessao, chamadas = sessao_com_respostas(
            resposta(200, {"accessRole": "owner", "items": [{"id": "ana-e1"}]}),
            resposta(403, {"error": {"errors": [{"reason": "forbidden"}]}}),
            resposta(200, {"accessRole": "writer", "items": [{"id": "caio-e1"}]}),
        )
        with tempfile.TemporaryDirectory(prefix="teste-agenda-") as pasta:
            args = SimpleNamespace(ano=2026, sala=salas, saida=Path(pasta))
            with (
                patch.object(agenda, "argumentos", return_value=args),
                patch.object(agenda, "carregar_credenciais", return_value=(object(), None)),
                patch.object(agenda, "AuthorizedSession", return_value=sessao),
                patch.object(agenda, "listar_usuarios", side_effect=AssertionError("Não consultar Directory")),
                redirect_stdout(io.StringIO()),
            ):
                codigo = agenda.main()
            arquivos = list(Path(pasta).glob("agenda-setembro-2026-*.json"))
            self.assertEqual(len(arquivos), 1)
            relatorio = json.loads(arquivos[0].read_text(encoding="utf-8"))
            self.assertFalse(arquivos[0].with_suffix(".md").exists())
            lista = arquivos[0].with_name(arquivos[0].stem + "-salas.md").read_text(encoding="utf-8")
            self.assertIn("Título não informado pela API", lista)
            self.assertEqual(list(Path(pasta).glob("*.tmp")), [])

        self.assertEqual(codigo, 2)
        self.assertEqual(len(chamadas), 3)
        for chamada, sala in zip(chamadas, salas):
            self.assertTrue(chamada[0].endswith('/' + agenda.quote(sala, safe='') + '/events'))
        self.assertTrue(relatorio["coleta_finalizada"])
        self.assertFalse(relatorio["completo_para_salas_selecionadas"])
        self.assertEqual(relatorio["total_agendas"], 3)
        self.assertNotIn("usuarios", relatorio)
        self.assertEqual([item["status"] for item in relatorio["agendas"]], ["ok", "erro", "ok"])
        self.assertEqual(relatorio["agendas"][2]["eventos"], [{"id": "caio-e1"}])
        self.assertEqual(relatorio["resumo"]["agendas_ok"], 2)
        self.assertEqual(relatorio["resumo"]["agendas_com_erro"], 1)
        self.assertEqual(relatorio["resumo"]["total_eventos_por_agenda"], 2)


class TestSnapshotPainel(unittest.TestCase):
    def evento(self, **campos):
        evento = {
            "id": "reserva", "iCalUID": "reserva@example.test", "summary": "Projeto",
            "start": {"dateTime": "2026-09-10T09:00:00-03:00"},
            "end": {"dateTime": "2026-09-10T10:00:00-03:00"},
            "creator": {"email": "criador@example.test"},
            "organizer": {"email": "organizador@example.test"},
            "attendees": [{"email": "convidado@example.test", "responseStatus": "accepted"}],
        }
        evento.update(campos)
        return evento

    def coletar(self, pasta, *respostas, salas=None):
        sessao, chamadas = sessao_com_respostas(*respostas)
        args = SimpleNamespace(ano=2026, sala=salas, saida=Path(pasta), painel=True)
        terminal, erros = io.StringIO(), io.StringIO()
        with (
            patch.object(agenda, "argumentos", return_value=args),
            patch.object(agenda, "carregar_credenciais", return_value=(object(), None)),
            patch.object(agenda, "AuthorizedSession", return_value=sessao),
            patch.object(agenda, "listar_usuarios", side_effect=AssertionError("Não consultar Directory")),
            patch.object(agenda, "salvar_gestao_sala", side_effect=AssertionError("Não gerar Markdown")),
            patch.object(agenda, "salvar_json", wraps=agenda.salvar_json) as salvar,
            redirect_stdout(terminal), redirect_stderr(erros),
        ):
            codigo = agenda.main()
        return codigo, terminal.getvalue(), erros.getvalue(), salvar, chamadas

    def test_edicoes_refletidas_em_um_unico_snapshot_sem_checkpoint_ou_markdown(self):
        original = self.evento()
        editado = self.evento(summary="Projeto revisado", description="Pauta atualizada",
                             start={"dateTime": "2026-09-11T14:30:00-03:00"},
                             end={"dateTime": "2026-09-11T16:00:00-03:00"},
                             attendees=[{"email": "novo@example.test", "responseStatus": "tentative"}])
        with tempfile.TemporaryDirectory(prefix="teste-snapshot-") as pasta:
            caminho = Path(pasta) / "agenda-setembro-2026-atual.json"
            for evento in (original, editado):
                codigo, terminal, _, salvar, chamadas = self.coletar(
                    pasta, resposta(200, {"accessRole": "owner", "items": [evento]}))
                self.assertEqual(codigo, 0)
                self.assertNotIn(evento["summary"], terminal)
                salvar.assert_called_once()
                self.assertTrue(salvar.call_args.args[1]["coleta_finalizada"])
                self.assertEqual(salvar.call_args.args[1]["formato"], "eventos_das_salas_v2")
                self.assertEqual(len(chamadas), 1)
                self.assertEqual(list(Path(pasta).iterdir()), [caminho])
            relatorio = json.loads(caminho.read_text(encoding="utf-8"))
        eventos = relatorio["gestao_sala"]["eventos_na_sala"]
        self.assertEqual(len(eventos), 1)
        self.assertEqual(eventos[0]["nome"], "Projeto revisado")
        self.assertEqual(eventos[0]["inicio"], "2026-09-11T14:30:00-03:00")
        self.assertEqual(eventos[0]["fim"], "2026-09-11T16:00:00-03:00")
        self.assertEqual(eventos[0]["descricao"], "Pauta atualizada")
        self.assertEqual(relatorio["agendas"][0]["eventos"], [editado])
        self.assertEqual(relatorio["emails_vinculados"], ["criador@example.test", "novo@example.test", "organizador@example.test"])

    def test_coleta_vazia_ou_cancelada_substitui_reservas_antigas(self):
        with tempfile.TemporaryDirectory(prefix="teste-snapshot-vazio-") as pasta:
            caminho = Path(pasta) / "agenda-setembro-2026-atual.json"
            for restantes in ([], [self.evento(status="cancelled")]):
                with self.subTest(restantes=restantes):
                    self.coletar(pasta, resposta(200, {"accessRole": "owner", "items": [self.evento()]}))
                    codigo, _, _, salvar, _ = self.coletar(pasta, resposta(200, {"accessRole": "owner", "items": restantes}))
                    self.assertEqual(codigo, 0)
                    salvar.assert_called_once()
                    relatorio = json.loads(caminho.read_text(encoding="utf-8"))
                    self.assertTrue(relatorio["coleta_finalizada"])
                    self.assertEqual(relatorio["gestao_sala"]["eventos_na_sala"], [])
                    self.assertEqual(relatorio["agendas"][0]["eventos"], [])
                    self.assertEqual(relatorio["emails_vinculados"], [])

    def test_reader_e_valido_preserva_aviso_e_retorna_2(self):
        with tempfile.TemporaryDirectory(prefix="teste-snapshot-reader-") as pasta:
            codigo, _, erros, salvar, _ = self.coletar(
                pasta, resposta(200, {"accessRole": "reader", "items": [self.evento()]}))
            relatorio = json.loads((Path(pasta) / "agenda-setembro-2026-atual.json").read_text(encoding="utf-8"))
        self.assertEqual(codigo, 2)
        self.assertEqual(erros, "")
        salvar.assert_called_once()
        self.assertEqual(relatorio["agendas"][0]["status"], "acesso_limitado")
        self.assertTrue(relatorio["agendas"][0]["aviso"])
        self.assertFalse(relatorio["completo_para_salas_selecionadas"])
        self.assertTrue(relatorio["coleta_finalizada"])
        self.assertEqual(len(relatorio["gestao_sala"]["eventos_na_sala"]), 1)

    def test_falha_na_pagina_seguinte_preserva_snapshot_sem_gravar_parcial(self):
        with tempfile.TemporaryDirectory(prefix="teste-snapshot-parcial-") as pasta:
            caminho = Path(pasta) / "agenda-setembro-2026-atual.json"
            self.coletar(pasta, resposta(200, {"accessRole": "owner", "items": [self.evento()]}))
            anterior = caminho.read_bytes()
            codigo, _, erros, salvar, chamadas = self.coletar(
                pasta,
                resposta(200, {"accessRole": "owner", "items": [self.evento(summary="Parcial")], "nextPageToken": "p2"}),
                resposta(403, {"error": {"errors": [{"reason": "forbidden"}]}}),
            )
            self.assertEqual(caminho.read_bytes(), anterior)
            self.assertEqual(list(Path(pasta).iterdir()), [caminho])
        self.assertEqual(codigo, 1)
        self.assertEqual(len(chamadas), 2)
        self.assertIn("snapshot anterior foi preservado", erros)
        salvar.assert_not_called()

    def test_uma_sala_com_erro_impede_publicacao_de_todas_as_salas(self):
        salas = ["primeira@resource.calendar.google.com", "segunda@resource.calendar.google.com"]
        with tempfile.TemporaryDirectory(prefix="teste-snapshot-multisalas-") as pasta:
            codigo, _, _, salvar, chamadas = self.coletar(
                pasta,
                resposta(200, {"accessRole": "owner", "items": [self.evento()]}),
                resposta(404, {"error": {"errors": [{"reason": "notFound"}]}}),
                salas=salas,
            )
            self.assertEqual(list(Path(pasta).iterdir()), [])
        self.assertEqual(codigo, 1)
        self.assertEqual(len(chamadas), 2)
        salvar.assert_not_called()

    def test_painel_rejeita_reprocessamento_sem_ler_arquivo(self):
        with patch.object(agenda.sys, "argv", [str(SCRIPT), "--painel", "--reprocessar", "inexistente.json"]):
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exc:
                agenda.argumentos()
        self.assertEqual(exc.exception.code, 2)
        with self.assertRaisesRegex(agenda.ErroAgenda, "--painel não pode"):
            agenda.executar(SimpleNamespace(painel=True, reprocessar=Path("inexistente.json")))


class TestGestaoSala(unittest.TestCase):
    def evento(self, **campos):
        evento = {
            "id": "evento1", "iCalUID": "uid1@example.test", "summary": "Alinhamento",
            "start": {"dateTime": "2026-09-10T09:00:00-03:00"},
            "end": {"dateTime": "2026-09-10T10:00:00-03:00"},
            "creator": {"email": "secretaria@example.test"},
            "organizer": {"email": "ana@example.test"},
            "attendees": [
                {"email": "ana@example.test", "responseStatus": "accepted"},
                {"email": "bia@example.test", "responseStatus": "needsAction"},
                {"email": "sala@resource.calendar.google.com", "displayName": "Sala de reuniões",
                 "resource": True, "responseStatus": "accepted"},
            ],
        }
        evento.update(campos)
        return evento

    def relatorio(self, *agendas):
        return {"ano": 2026, "mes": 9, "total_usuarios": len(agendas), "coleta_finalizada": True,
                "usuarios": [{"email": email, "status": "ok", "eventos": eventos} for email, eventos in agendas]}

    def test_mesma_reuniao_nao_soma_copias_nem_participantes(self):
        evento = self.evento()
        copia = deepcopy(evento)
        copia["id"] = "id-diferente-em-outra-agenda"
        resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [evento]), ("bia@example.test", [copia])))
        self.assertEqual(resultado["resumo"]["eventos_unicos"], 1)
        self.assertEqual(resultado["resumo"]["copias_duplicadas_agrupadas"], 1)
        unico = resultado["eventos_na_sala"][0]
        self.assertEqual(unico["participantes"]["pessoas_convidadas"], 2)
        self.assertEqual(unico["participantes"]["aceites_observados"], 1)
        self.assertEqual(unico["criador"]["email"], "secretaria@example.test")
        self.assertEqual(unico["copias_encontradas"], 2)
        self.assertTrue(unico["bloqueio_confirmado"])

    def test_recorrencias_separadas_e_instancia_remarcada_agrupada_por_inicio_original(self):
        primeira = self.evento(recurringEventId="serie", originalStartTime={"dateTime": "2026-09-10T12:00:00Z"})
        remarcada = deepcopy(primeira)
        remarcada["originalStartTime"] = {"dateTime": "2026-09-10T09:00:00-03:00"}
        remarcada["start"] = {"dateTime": "2026-09-11T09:00:00-03:00"}
        segunda = self.evento(recurringEventId="serie", originalStartTime={"dateTime": "2026-09-17T09:00:00-03:00"})
        resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [primeira, segunda]), ("bia@example.test", [remarcada])))
        self.assertEqual(resultado["resumo"]["eventos_unicos"], 2)
        self.assertEqual(sorted(e["copias_encontradas"] for e in resultado["eventos_na_sala"]), [1, 2])

    def test_titulos_e_horarios_iguais_nao_sao_identidade_e_id_e_local_a_agenda(self):
        primeiro, segundo = self.evento(), self.evento(iCalUID="outro-uid")
        sem_uid = self.evento()
        del sem_uid["iCalUID"]
        resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [primeiro, segundo, sem_uid]),
                                                       ("bia@example.test", [deepcopy(sem_uid)])))
        self.assertEqual(resultado["resumo"]["eventos_unicos"], 4)
        self.assertEqual(resultado["resumo"]["copias_duplicadas_agrupadas"], 0)

    def test_recursos_recusas_e_acompanhantes_na_contagem(self):
        evento = self.evento()
        evento["attendees"] += [
            {"email": "ANA@example.test", "responseStatus": "accepted"},
            {"email": "caio@example.test", "responseStatus": "declined", "additionalGuests": 1},
            {"email": "duda@example.test", "responseStatus": "accepted", "additionalGuests": 2},
            {"email": "projetor@resource.calendar.google.com", "responseStatus": "accepted"},
        ]
        p = agenda.dados_participantes(evento)
        self.assertEqual(p["convidados_identificados"], 4)
        self.assertEqual(p["pessoas_convidadas"], 7)
        self.assertEqual(p["aceites_observados"], 4)
        self.assertEqual(p["recusas_observadas"], 2)
        self.assertIsNone(p["pessoas_presenciais"])

    def test_lista_ausente_omitida_ou_restrita_nao_e_total_zero(self):
        ausente = self.evento()
        del ausente["attendees"]
        for evento in (ausente, self.evento(attendeesOmitted=True), self.evento(guestsCanSeeOtherGuests=False)):
            with self.subTest(evento=evento):
                p = agenda.dados_participantes(evento)
                self.assertIsNone(p["pessoas_convidadas"])
                self.assertTrue(p["lista_possivelmente_incompleta"])

    def test_apenas_nome_reuniao_fica_para_revisao_mas_local_sem_acento_entra(self):
        virtual = self.evento(iCalUID="virtual", summary="REUNIÃO comercial", attendees=[], location="Microsoft Teams")
        presencial = self.evento(iCalUID="local", summary="Alinhamento de projetos", attendees=[], location="SALA DE REUNIOES")
        resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [virtual, presencial])))
        self.assertEqual([e["ical_uid"] for e in resultado["eventos_na_sala"]], ["local"])
        self.assertFalse(resultado["eventos_na_sala"][0]["bloqueio_confirmado"])
        self.assertEqual(resultado["fora_do_filtro"][0]["classificacao"], "revisar_sala")

    def test_recurso_recusado_prevalece_sobre_local_e_pendente_nao_confirma_reserva(self):
        for resposta, incluido, categoria in (("declined", False, "sala_recusou"), ("needsAction", True, "sala_pendente")):
            evento = self.evento(location="Sala de reunião")
            evento["attendees"][-1]["responseStatus"] = resposta
            resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [evento])))
            unico = (resultado["eventos_na_sala"] if incluido else resultado["fora_do_filtro"])[0]
            self.assertEqual(unico["classificacao"], categoria)
            self.assertFalse(unico["bloqueio_confirmado"])

    def test_cancelados_e_ausencias_excluidos_transparentes_e_provisorios_sem_bloqueio(self):
        for campos, incluido in (({"status": "cancelled"}, False), ({"eventType": "outOfOffice"}, False),
                                 ({"transparency": "transparent"}, True), ({"status": "tentative"}, True),
                                 ({"end": {}}, True)):
            resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [self.evento(**campos)])))
            unico = (resultado["eventos_na_sala"] if incluido else resultado["fora_do_filtro"])[0]
            self.assertFalse(unico["bloqueio_confirmado"])

    def test_sala_por_email_ou_nome_personalizado_e_alias_sem_nome(self):
        evento = self.evento()
        evento["attendees"][-1]["displayName"] = "Auditório Central"
        for seletor in ("auditorio central", "sala@resource.calendar.google.com"):
            resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [evento])), [seletor])
            self.assertEqual(resultado["resumo"]["eventos_na_sala"], 1)
        outro = deepcopy(evento)
        outro["iCalUID"] = "outro"
        del outro["attendees"][-1]["displayName"]
        resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [evento, outro])), ["auditorio central"])
        self.assertEqual(resultado["resumo"]["eventos_na_sala"], 2)

    def test_copia_organizador_prevalece_sem_somar_lista_antiga(self):
        atual = self.evento(updated="2026-09-10T08:00:00Z")
        antiga = self.evento(updated="2026-09-10T09:00:00Z")
        antiga["attendees"].append({"email": "removido@example.test", "responseStatus": "accepted"})
        resultado = agenda.analisar_salas(self.relatorio(("bia@example.test", [antiga]), ("ana@example.test", [atual])))
        evento = resultado["eventos_na_sala"][0]
        self.assertEqual(evento["agenda_copia_utilizada"], "ana@example.test")
        self.assertEqual(evento["participantes"]["pessoas_convidadas"], 2)
        self.assertTrue(evento["avisos"])

    def test_dia_inteiro_e_virada_do_mes_preservam_datas_e_fim_exclusivo(self):
        evento = self.evento(start={"date": "2026-09-30"}, end={"date": "2026-10-02"})
        resultado = agenda.analisar_salas(self.relatorio(("ana@example.test", [evento])))
        unico = resultado["eventos_na_sala"][0]
        self.assertTrue(unico["dia_inteiro"])
        self.assertEqual(unico["fim"], "2026-10-02T00:00:00-03:00")
        self.assertEqual(unico["fim_legivel"], "01/10/2026 (dia inteiro)")

    def test_reprocessamento_offline_preserva_original_e_exibe_apenas_eventos_da_sala(self):
        dentro = self.evento(summary="Projeto | <script>teste</script>")
        fora = self.evento(iCalUID="fora", summary="Reunião remota", attendees=[])
        relatorio = self.relatorio(("ana@example.test", [dentro, fora]), ("bia@example.test", [deepcopy(dentro)]))
        with tempfile.TemporaryDirectory(prefix="teste-filtro-") as pasta:
            origem = Path(pasta) / "original.json"
            origem.write_text(json.dumps(relatorio), encoding="utf-8")
            original = origem.read_bytes()
            saida = Path(pasta) / "saida"
            args = SimpleNamespace(reprocessar=origem, saida=saida, sala=None)
            terminal = io.StringIO()
            with patch.object(agenda, "carregar_credenciais") as credenciais, redirect_stdout(terminal):
                self.assertEqual(agenda.executar(args), 0)
            credenciais.assert_not_called()
            self.assertEqual(origem.read_bytes(), original)
            exportado = json.loads(next(saida.glob("*.json")).read_text(encoding="utf-8"))
            texto = next(saida.glob("*-salas.md")).read_text(encoding="utf-8")
        analise = exportado["gestao_sala"]
        self.assertNotIn("usuarios", exportado)
        self.assertEqual(exportado["agendas"][0]["eventos"], [dentro])
        self.assertEqual(analise["resumo"]["eventos_unicos"], len(analise["eventos_na_sala"]) + analise["resumo"]["eventos_fora_do_filtro"])
        self.assertNotIn("<script>", texto)
        self.assertIn("\\| &lt;script&gt;", texto)
        self.assertIn("Projeto", texto)
        self.assertIn("Projeto", terminal.getvalue())
        self.assertNotIn("Reunião remota", texto)
        self.assertNotIn("Reunião remota", terminal.getvalue())
        self.assertNotIn("## Eventos fora do filtro", texto)
        self.assertNotIn("FORA DO FILTRO:", terminal.getvalue())
        self.assertNotIn("fora_do_filtro", analise)
        self.assertNotIn("Reunião remota", json.dumps(exportado, ensure_ascii=False))

    def test_escopo_calendar_suficiente_e_service_account_representa_conta_com_acesso(self):
        agenda.validar_escopos(SimpleNamespace(granted_scopes=None, scopes=[agenda.ESCOPO_EVENTOS]))
        self.assertEqual(agenda.ESCOPOS, [agenda.ESCOPO_EVENTOS])
        base = Mock()
        args = SimpleNamespace(conta_servico=Path("ficticio.json"), admin="gestor@example.test")
        with patch.object(agenda.service_account.Credentials, "from_service_account_file", return_value=base):
            agenda.carregar_credenciais(args)
        base.with_scopes.assert_called_once_with([agenda.ESCOPO_EVENTOS])
        base.with_scopes.return_value.with_subject.assert_called_once_with("gestor@example.test")

    def test_sala_padrao_e_nome_resolvem_mesmo_id_sem_listar_pessoas(self):
        self.assertEqual(agenda.resolver_salas(), [agenda.SALA_PADRAO])
        self.assertEqual(agenda.resolver_salas([agenda.SALA_PADRAO["nome"], agenda.SALA_PADRAO["email"]]), [agenda.SALA_PADRAO])
        with self.assertRaisesRegex(agenda.ErroAgenda, "e-mail/ID"):
            agenda.resolver_salas(["Sala desconhecida"])

    def test_evento_direto_na_agenda_da_sala_nao_exige_titulo_local_ou_convite(self):
        evento = self.evento(summary="Reservado", attendees=[])
        relatorio = {"agendas": [{"email": agenda.SALA_PADRAO["email"], "nome": agenda.SALA_PADRAO["nome"],
                                 "tipo": "sala", "eventos": [evento]}]}
        analise = agenda.analisar_salas(relatorio)
        self.assertEqual(analise["resumo"]["eventos_na_sala"], 1)
        self.assertEqual(analise["eventos_na_sala"][0]["classificacao"], "agenda_da_sala")
        outra_sala = agenda.analisar_salas(relatorio, ["outra@resource.calendar.google.com"])
        self.assertEqual(outra_sala["resumo"]["eventos_na_sala"], 0)

    def test_exportacao_nao_inclui_contas_ou_eventos_sem_vinculo_e_pode_ser_reanalisada(self):
        dentro = self.evento()
        fora = self.evento(iCalUID="particular", summary="Particular", attendees=[], creator={"email": "alheio@example.test"})
        relatorio = self.relatorio(("ana@example.test", [dentro]), ("alheio@example.test", [fora]))
        exportado = agenda.exportacao_da_sala(relatorio, agenda.analisar_salas(relatorio))
        self.assertNotIn("alheio@example.test", json.dumps(exportado))
        self.assertEqual(exportado["emails_vinculados"], ["ana@example.test", "bia@example.test", "secretaria@example.test"])
        self.assertEqual(agenda.analisar_salas(exportado)["resumo"]["eventos_na_sala"], 1)


if __name__ == "__main__":
    unittest.main()
