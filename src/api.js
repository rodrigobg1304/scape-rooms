// Acceso a Supabase: sesión anónima y llamadas RPC del juego.
// La URL y la clave anon son públicas por diseño; la seguridad la ponen RLS y las funciones.
import { createClient } from '@supabase/supabase-js';

// Tolera errores al copiar la URL (espacios, barra final, /rest/v1…): solo cuenta el dominio.
function origen(texto) {
  try { return new URL(String(texto || '').trim().replace(/^["']|["']$/g, '')).origin; } catch (x) { return ''; }
}
const SUPABASE_URL = origen(import.meta.env.VITE_SUPABASE_URL);
const CLAVE = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim().replace(/^["']|["']$/g, '');

export const configurado = Boolean(SUPABASE_URL && CLAVE);
export const supabase = configurado ? createClient(SUPABASE_URL, CLAVE) : null;

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
