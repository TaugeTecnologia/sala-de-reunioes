import React from 'react';
import { useReservas } from '../context/ReservasContext';
import { formatarData } from '../utils/reservas';

export default function ListaReservas({ reservas }) {
  const { salas } = useReservas();
  if (!reservas.length) return <div className="empty">Nenhuma reserva para esta seleção.</div>;
  return <div className="booking-list">{[...reservas].sort((a, b) => `${a.data}${a.inicio}`.localeCompare(`${b.data}${b.inicio}`)).map((reserva) => <article className="booking" key={reserva.id}>
    <div className="booking-time"><strong>{reserva.inicio}</strong><span>até {reserva.fim}</span></div>
    <div className="booking-info"><h3>{reserva.titulo}</h3><p>{salas.find((sala) => sala.id === reserva.salaId)?.nome} · {reserva.responsavel}</p></div>
    <span className="date-label">{formatarData(reserva.data)}</span>
  </article>)}</div>;
}
