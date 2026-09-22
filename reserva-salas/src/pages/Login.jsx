import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useReservas } from '../context/ReservasContext';

export default function Login() {
  const [nome, setNome] = useState('');
  const { usuario, setUsuario } = useReservas();
  const navigate = useNavigate();
  if (usuario) return <Navigate to="/dashboard" replace />;
  function entrar(event) {
    event.preventDefault();
    if (!nome.trim()) return;
    setUsuario({ nome: nome.trim() });
    navigate('/dashboard');
  }
  return <main className="login"><section className="login-intro"><span className="eyebrow">SALAS / ESPAÇO DE TRABALHO</span><h1>O espaço certo.<br />A próxima ideia.</h1><p>Organize os encontros da equipe em um só lugar.</p></section>
    <section className="login-card"><span className="eyebrow">BEM-VINDO</span><h2>Entre para explorar</h2><p>Este acesso é uma simulação. Use um nome de exemplo; nenhuma senha é necessária.</p><form onSubmit={entrar}><label htmlFor="nome">Seu nome</label><input id="nome" value={nome} onChange={(event) => setNome(event.target.value)} maxLength={60} required placeholder="Ex.: Ana Silva" autoComplete="name" /><button className="button" disabled={!nome.trim()}>Entrar na demonstração</button></form><small>Dados fictícios. Sem autenticação real.</small></section>
  </main>;
}
