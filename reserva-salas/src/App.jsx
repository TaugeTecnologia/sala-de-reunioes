import React from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useReservas } from './context/ReservasContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Salas from './pages/Salas';
import Agenda from './pages/Agenda';
import Reserva from './pages/Reserva';

export default function App() {
  const { usuario } = useReservas();
  return <Routes>
    <Route path="/login" element={<Login />} />
    {/* Esta barreira serve apenas para o fluxo visual; não oferece segurança real. */}
    <Route element={usuario ? <Layout /> : <Navigate to="/login" replace />}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/salas" element={<Salas />} />
      <Route path="/agenda" element={<Agenda />} />
      <Route path="/reserva" element={<Reserva />} />
    </Route>
    <Route path="/" element={<Navigate to={usuario ? '/dashboard' : '/login'} replace />} />
    <Route path="*" element={<div className="not-found"><h1>Página não encontrada</h1><Link to="/">Voltar ao início</Link></div>} />
  </Routes>;
}
