// Usa o dia local para evitar que a conversão para UTC altere a data.
export function dataLocal(data = new Date()) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

export function validarReserva(nova, reservas, salas, agora = new Date()) {
  if (!salas.some((sala) => sala.id === nova.salaId && sala.ativa)) return 'Selecione uma sala ativa.';
  if (!nova.titulo.trim()) return 'Informe o título da reunião.';
  if (!nova.data || !nova.inicio || !nova.fim) return 'Preencha a data e os horários.';
  if (nova.inicio >= nova.fim) return 'O horário final deve ser posterior ao início.';
  const inicio = new Date(`${nova.data}T${nova.inicio}:00`);
  if (Number.isNaN(inicio.getTime()) || inicio <= agora) return 'Escolha um horário futuro.';
  const conflito = reservas.some((reserva) => reserva.salaId === nova.salaId && reserva.data === nova.data && nova.inicio < reserva.fim && nova.fim > reserva.inicio);
  return conflito ? 'Esta sala já está reservada nesse intervalo. Escolha outro horário.' : '';
}

export function formatarData(data) {
  return new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}
