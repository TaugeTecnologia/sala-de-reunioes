import test from 'node:test';
import assert from 'node:assert/strict';
import { validarReserva, dataLocal } from './reservas.js';

const salas = [{ id: 'a', ativa: true }, { id: 'b', ativa: true }, { id: 'c', ativa: false }];
const agora = new Date('2026-09-11T08:00:00');
const base = { salaId: 'a', titulo: 'Reunião', data: '2026-09-11', inicio: '10:00', fim: '11:00' };
const existentes = [{ ...base }];
const validar = (alteracoes = {}) => validarReserva({ ...base, ...alteracoes }, existentes, salas, agora);

test('recusa intervalos coincidentes, parciais e que envolvem a reserva', () => {
  for (const [inicio, fim] of [['10:00', '11:00'], ['09:30', '10:30'], ['10:30', '11:30'], ['09:00', '12:00'], ['10:15', '10:45']]) {
    assert.match(validar({ inicio, fim }), /já está reservada/);
  }
});
test('permite horários adjacentes, outra sala e outro dia', () => {
  assert.equal(validar({ inicio: '09:00', fim: '10:00' }), '');
  assert.equal(validar({ inicio: '11:00', fim: '12:00' }), '');
  assert.equal(validar({ salaId: 'b' }), '');
  assert.equal(validar({ data: '2026-09-12' }), '');
});
test('recusa sala inativa, título vazio, passado e duração inválida', () => {
  assert.match(validar({ salaId: 'c' }), /sala ativa/);
  assert.match(validar({ titulo: '   ' }), /título/);
  assert.match(validar({ inicio: '07:00', fim: '08:00' }), /futuro/);
  assert.match(validar({ fim: '09:00' }), /posterior/);
  assert.match(validar({ fim: '10:00' }), /posterior/);
});
test('formata a data usando o calendário local', () => {
  assert.equal(dataLocal(new Date(2026, 0, 2, 23, 30)), '2026-01-02');
});
