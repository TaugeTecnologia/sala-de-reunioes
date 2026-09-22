import React from 'react';
import { Link } from 'react-router-dom';
import { useReservas } from '../context/ReservasContext';
import { dataLocal } from '../utils/reservas';
import ListaReservas from '../components/ListaReservas';

export default function Dashboard() {
  const { usuario, salas, reservas } = useReservas();
  const hoje = reservas.filter((reserva) => reserva.data === dataLocal());
  return <><header className="page-header"><div><p className="eyebrow">VISÃO GERAL</p><h1>Olá, {usuario.nome.split(' ')[0]}.</h1><p>Encontre um espaço para o próximo encontro.</p></div><Link className="button" to="/reserva">+ Nova reserva</Link></header>
    <div className="stats"><article><span>Salas ativas</span><strong>{salas.filter((sala) => sala.ativa).length.toString().padStart(2, '0')}</strong><small>Prontas para agendamento</small></article><article><span>Reservas hoje</span><strong>{hoje.length.toString().padStart(2, '0')}</strong><small>Agenda de toda a equipe</small></article><article><span>Capacidade total</span><strong>{salas.filter((sala) => sala.ativa).reduce((total, sala) => total + sala.capacidade, 0)}</strong><small>Pessoas nas salas ativas</small></article></div>
    <section className="panel"><div className="section-header"><h2>Na agenda de hoje</h2><Link to="/agenda">Ver agenda completa →</Link></div><ListaReservas reservas={hoje} /></section>
    <div className="callout"><div><h2>Cada encontro tem seu espaço.</h2><p>Consulte a capacidade e os recursos antes de reservar.</p></div><Link className="button secondary" to="/salas">Explorar salas</Link></div>
  </>;
}
