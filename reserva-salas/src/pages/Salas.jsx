import React from 'react';
import { Link } from 'react-router-dom';
import { useReservas } from '../context/ReservasContext';

export default function Salas() {
  const { salas } = useReservas();
  return <><header className="page-header"><div><p className="eyebrow">NOSSOS ESPAÇOS</p><h1>Salas de reunião</h1><p>Escolha o espaço ideal. A disponibilidade depende do horário.</p></div></header><div className="room-grid">{salas.map((sala, indice) => <article className="room-card" key={sala.id}><div className="room-top"><span className="room-number">0{indice + 1}</span><span className={`badge ${sala.ativa ? '' : 'muted'}`}>{sala.ativa ? 'Ativa' : 'Indisponível'}</span></div><h2>{sala.nome}</h2><p>{sala.descricao}</p><div className="room-details">Até {sala.capacidade} pessoas <span>·</span> {sala.localizacao}</div><div className="tags">{sala.recursos.map((recurso) => <span key={recurso}>{recurso}</span>)}</div>{sala.ativa ? <Link className="button secondary" to={`/reserva?sala=${sala.id}`}>Reservar sala →</Link> : <button className="button secondary" disabled>Fora de operação</button>}</article>)}</div></>;
}
