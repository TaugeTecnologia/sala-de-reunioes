"""Formato de resposta que o painel espera de /api/agenda.

Espelho de serializeReport() em server/app.mjs: o coletor devolve o JSON bruto
(eventos_das_salas_v2) e o painel lê a versão resumida (periodo, salas, eventos...).
Manter os dois em sincronia; api/test_agenda_api.py compara os campos essenciais."""

EVENT_FIELDS = [
    "chave", "ical_uid", "id_evento", "nome", "data", "inicio", "fim", "inicio_legivel", "fim_legivel",
    "dia_inteiro", "fim_exclusivo", "duracao_minutos", "criador", "organizador", "local", "salas",
    "participantes", "descricao", "tem_conferencia_online", "modalidade", "classificacao", "motivo",
    "bloqueio_confirmado", "agenda_copia_utilizada", "copias_encontradas", "agendas_origem", "avisos",
]
PUBLIC_PARTICIPANT_FIELDS = ("pessoas_convidadas", "lista_possivelmente_incompleta")
PUBLIC_GUEST_FIELDS = ("nome", "email", "convidados_adicionais")


def _lista(valor):
    return valor if isinstance(valor, list) else []


def _unicos(valores):
    vistos = []
    for valor in valores:
        if isinstance(valor, str) and valor.strip() and valor not in vistos:
            vistos.append(valor)
    return vistos


def _participantes_publicos(valor):
    origem = valor if isinstance(valor, dict) else {}
    resultado = {chave: origem[chave] for chave in PUBLIC_PARTICIPANT_FIELDS if chave in origem}
    if isinstance(origem.get("lista"), list):
        resultado["lista"] = [
            {chave: pessoa[chave] for chave in PUBLIC_GUEST_FIELDS if chave in pessoa}
            for pessoa in origem["lista"] if isinstance(pessoa, dict)
        ]
    return resultado


def serializar_relatorio(relatorio, arquivo, avisos_extras=()):
    salas = [{
        "id": sala.get("calendar_id") or sala.get("email") or "",
        "nome": sala.get("nome") or "Sala de reunião",
        "status": sala.get("status") or "erro",
        "aviso": sala.get("aviso") or sala.get("erro")
                 or ("O Google pode ocultar detalhes de eventos privados." if sala.get("status") == "acesso_limitado" else None),
    } for sala in _lista(relatorio.get("agendas"))]
    eventos = [{campo: (_participantes_publicos(evento[campo]) if campo == "participantes" else evento[campo])
                for campo in EVENT_FIELDS if campo in evento}
               for evento in _lista((relatorio.get("gestao_sala") or {}).get("eventos_na_sala"))]
    return {
        "arquivo": arquivo,
        "geradoEm": relatorio.get("gerado_em"),
        "periodo": {
            "ano": relatorio.get("ano"), "mes": relatorio.get("mes"),
            "inicio": relatorio.get("time_min"), "fim": relatorio.get("time_max"),
            "fuso": relatorio.get("fuso") or "UTC-03:00",
        },
        "salas": salas,
        "eventos": eventos,
        "avisos": _unicos([*avisos_extras, relatorio.get("observacao"), *[s["aviso"] for s in salas],
                           *[a for e in eventos for a in _lista(e.get("avisos"))]]),
        "coletaFinalizada": relatorio.get("coleta_finalizada") is True,
    }
