import React, { createContext, useContext, useState } from 'react';
import { criarReservasIniciais, salas } from '../data/mock';
import { validarReserva } from '../utils/reservas';

const ReservasContext = createContext(null);

export function ReservasProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [reservas, setReservas] = useState(criarReservasIniciais);

  function criarReserva(dados) {
    const erro = validarReserva(dados, reservas, salas);
    if (erro) return erro;
    setReservas((atuais) => [...atuais, { ...dados, titulo: dados.titulo.trim(), id: crypto.randomUUID(), responsavel: usuario.nome }]);
    return '';
  }

  return <ReservasContext.Provider value={{ usuario, setUsuario, reservas, salas, criarReserva }}>{children}</ReservasContext.Provider>;
}

export function useReservas() { return useContext(ReservasContext); }
