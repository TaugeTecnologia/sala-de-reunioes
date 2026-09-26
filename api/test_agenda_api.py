"""Testes offline de api/agenda.py: garante que a função do Vercel monta as credenciais
certas e devolve o JSON no formato eventos_das_salas_v2, sem tocar a rede nem reimplementar
a lógica de coletor/trazer-agenda-de-setembro.py (só a integração é testada aqui)."""
import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("api_agenda", HERE / "agenda.py")
api_agenda = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api_agenda)


def resposta(status, dados):
    retorno = Mock(status_code=status)
    retorno.json.return_value = dados
    return retorno


def sessao_com_eventos(eventos):
    sessao = Mock()
    sessao.get.return_value = resposta(200, {"items": eventos, "accessRole": "owner"})
    sessao.__enter__ = Mock(return_value=sessao)
    sessao.__exit__ = Mock(return_value=False)
    return sessao


class TestApiAgenda(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "GOOGLE_REFRESH_TOKEN": "refresh-de-teste",
            "GOOGLE_OAUTH_CLIENT_ID": "cliente-de-teste",
            "GOOGLE_OAUTH_CLIENT_SECRET": "segredo-de-teste",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_configuracao_incompleta_gera_erro_amigavel(self):
        with patch.dict(os.environ, {"GOOGLE_REFRESH_TOKEN": ""}):
            with self.assertRaises(api_agenda.coletor.ErroAgenda) as ctx:
                api_agenda._credenciais()
            self.assertIn("GOOGLE_REFRESH_TOKEN", str(ctx.exception))

    def test_credenciais_usa_variaveis_de_ambiente(self):
        creds = api_agenda._credenciais()
        self.assertEqual(creds.refresh_token, "refresh-de-teste")
        self.assertEqual(creds.client_id, "cliente-de-teste")
        self.assertEqual(creds.client_secret, "segredo-de-teste")
        self.assertEqual(creds.scopes, [api_agenda.coletor.ESCOPO_EVENTOS])

    def test_buscar_agenda_retorna_formato_eventos_das_salas_v2(self):
        evento = {
            "id": "abc", "iCalUID": "abc@google.com", "summary": "Reunião de teste",
            "start": {"dateTime": "2026-09-25T14:00:00-03:00"}, "end": {"dateTime": "2026-09-25T15:00:00-03:00"},
            "creator": {"email": "ana@tauge.com.br"}, "organizer": {"email": "ana@tauge.com.br"},
            "attendees": [{"email": "ana@tauge.com.br", "responseStatus": "accepted"}],
        }
        with patch.object(api_agenda, "AuthorizedSession", return_value=sessao_com_eventos([evento])), \
             patch.object(api_agenda, "_credenciais", return_value=Mock()):
            resultado = api_agenda.buscar_agenda(2026, 9)
        self.assertEqual(resultado["formato"], "eventos_das_salas_v2")
        self.assertEqual(resultado["ano"], 2026)
        self.assertEqual(len(resultado["gestao_sala"]["eventos_na_sala"]), 1)
        self.assertEqual(resultado["gestao_sala"]["eventos_na_sala"][0]["nome"], "Reunião de teste")

    def test_agenda_com_erro_de_consulta_lanca_erro_agenda(self):
        sessao = Mock()
        sessao.get.return_value = resposta(500, {})
        sessao.__enter__ = Mock(return_value=sessao)
        sessao.__exit__ = Mock(return_value=False)
        with patch.object(api_agenda, "AuthorizedSession", return_value=sessao), \
             patch.object(api_agenda, "_credenciais", return_value=Mock()):
            with self.assertRaises(api_agenda.coletor.ErroAgenda):
                api_agenda.buscar_agenda(2026, 9)

    def test_read_session_reaproveitado_de_api_lib(self):
        # Confere que api/agenda.py carregou a mesma verificação usada nos outros testes.
        self.assertIsNone(api_agenda.read_session({}))


if __name__ == "__main__":
    unittest.main()
