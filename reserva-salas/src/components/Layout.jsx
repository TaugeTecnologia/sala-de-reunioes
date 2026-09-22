import React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useReservas } from '../context/ReservasContext';

export default function Layout() {
  const { usuario, setUsuario } = useReservas();
  const navigate = useNavigate();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" to="/dashboard"><span className="brand-mark">S</span> salas<span className="brand-dot">.</span></Link>
      <p className="nav-label">ESPAÇO DE TRABALHO</p>
      <nav aria-label="Navegação principal">
        <NavLink to="/dashboard">Visão geral</NavLink>
        <NavLink to="/salas">Salas</NavLink>
        <NavLink to="/agenda">Agenda</NavLink>
        <NavLink to="/reserva">Nova reserva</NavLink>
      </nav>
      <div className="profile"><strong>{usuario.nome}</strong><span>Modo de demonstração</span><button className="text-button" onClick={() => { setUsuario(null); navigate('/login'); }}>Sair</button></div>
    </aside>
    <main id="conteudo"><div className="demo-bar">Protótipo • As alterações são temporárias e reiniciam ao recarregar.</div><Outlet /></main>
  </div>;
}
