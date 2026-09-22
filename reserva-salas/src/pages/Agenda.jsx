import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useReservas } from '../context/ReservasContext';
import ListaReservas from '../components/ListaReservas';

export default function Agenda() {
  const { reservas, salas } = useReservas();
  const [data, setData] = useState('');
  const [salaId, setSalaId] = useState('');
  const location = useLocation();
  const lista = reservas.filter((reserva) => (!data || reserva.data === data) && (!salaId || reserva.salaId === salaId));
  return <><header className="page-header"><div><p className="eyebrow">ENCONTROS DA EQUIPE</p><h1>Agenda</h1><p>Consulte as reservas por data e sala.</p></div><Link className="button" to="/reserva">+ Nova reserva</Link></header>
    {location.state?.sucesso && <p className="success" role="status">Reserva criada nesta demonstração. Ela aparece abaixo.</p>}
    <section className="panel"><div className="filters"><label>Data<input type="date" value={data} onChange={(event) => setData(event.target.value)} /></label><label>Sala<select value={salaId} onChange={(event) => setSalaId(event.target.value)}><option value="">Todas as salas</option>{salas.map((sala) => <option key={sala.id} value={sala.id}>{sala.nome}</option>)}</select></label><button className="text-button" onClick={() => { setData(''); setSalaId(''); }}>Limpar filtros</button></div><ListaReservas reservas={lista} /></section>
  </>;
}
