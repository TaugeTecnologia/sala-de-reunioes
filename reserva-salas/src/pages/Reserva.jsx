import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useReservas } from '../context/ReservasContext';
import { dataLocal } from '../utils/reservas';
import ListaReservas from '../components/ListaReservas';

export default function Reserva() {
  const { salas, reservas, criarReserva } = useReservas();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [dados, setDados] = useState({ salaId: salas.find((sala) => sala.id === params.get('sala') && sala.ativa)?.id || '', titulo: '', data: dataLocal(), inicio: '', fim: '' });
  const [erro, setErro] = useState('');
  function alterar(event) { setDados({ ...dados, [event.target.name]: event.target.value }); setErro(''); }
  function salvar(event) {
    event.preventDefault();
    const mensagem = criarReserva(dados);
    if (mensagem) { setErro(mensagem); return; }
    navigate('/agenda', { state: { sucesso: true } });
  }
  return <><header className="page-header"><div><p className="eyebrow">ORGANIZE UM ENCONTRO</p><h1>Nova reserva</h1><p>Escolha a sala, a data e o horário da reunião.</p></div></header><div className="reservation-grid"><form className="panel reservation-form" onSubmit={salvar}>
    <label>Sala<select name="salaId" value={dados.salaId} onChange={alterar} required><option value="">Selecione uma sala</option>{salas.filter((sala) => sala.ativa).map((sala) => <option key={sala.id} value={sala.id}>{sala.nome} • {sala.capacidade} pessoas</option>)}</select></label>
    <label>Título da reunião<input name="titulo" value={dados.titulo} onChange={alterar} placeholder="Ex.: Planejamento semanal" maxLength={100} required /></label>
    <label>Data<input name="data" type="date" min={dataLocal()} value={dados.data} onChange={alterar} required /></label>
    <div className="time-fields"><label>Início<input name="inicio" type="time" value={dados.inicio} onChange={alterar} required /></label><label>Fim<input name="fim" type="time" value={dados.fim} onChange={alterar} required /></label></div>
    {erro && <p className="error" role="alert">{erro}</p>}<button className="button">Confirmar reserva de demonstração</button>
  </form><section className="panel"><h2>Reservas neste dia</h2><p className="muted-text">{dados.salaId ? 'Confira os horários já ocupados na sala selecionada.' : 'Selecione uma sala para consultar os horários.'}</p>{dados.salaId && <ListaReservas reservas={reservas.filter((reserva) => reserva.salaId === dados.salaId && reserva.data === dados.data)} />}</section></div></>;
}
