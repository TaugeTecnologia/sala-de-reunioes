import React from 'react';
import App from './App.jsx';
import { useDemoAgendaPeriods } from './lib/demo-agenda.js';

// Entrada exclusiva da branch de preview. Não consulta a API nem cria sessão.
export default function DemoRoot() {
  return <App agendaSource={useDemoAgendaPeriods} demo usuario={{ nome: 'Visitante de teste' }}/>
}
