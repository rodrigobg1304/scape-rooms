// Acceso a Supabase: sesión anónima y llamadas RPC del juego.
// La URL y la clave anon son públicas por diseño; la seguridad la ponen RLS y las funciones.
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const CLAVE = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configurado = Boolean(URL && CLAVE);
export const supabase = configurado ? createClient(URL, CLAVE) : null;

// Inicia sesión anónima si no hay ninguna. La cuenta se puede vincular a un email más adelante.
export async function sesion() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error('No se ha podido iniciar sesión: ' + error.message);
  return data.session;
}

async function rpc(nombre, args) {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) {
    const e = new Error(error.message || 'Error de conexión');
    e.codigo = error.code;
    throw e;
  }
  return data;
}

export const api = {
  misCasos: () => rpc('mis_casos'),
  iniciar: caso => rpc('iniciar_partida', { p_caso: caso }),
  estado: partida => rpc('estado_partida', { p_partida: partida }),
  comprobar: (partida, respuesta) => rpc('comprobar_respuesta', { p_partida: partida, p_respuesta: respuesta }),
  pista: partida => rpc('pedir_pista', { p_partida: partida }),
  reiniciar: partida => rpc('reiniciar_partida', { p_partida: partida }),
};
