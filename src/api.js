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

// ---- Cuenta ----------------------------------------------------------------
const RAIZ = () => location.origin + location.pathname;

function traducir(e) {
  const m = String((e && e.message) || e || '');
  if (/already (been )?registered|already exists|email_exists|user_already_exists/i.test(m)) return 'Ese correo ya tiene cuenta. Usa "Entrar".';
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Aún no has confirmado el correo. Revisa tu bandeja (y spam).';
  if (/password.*(at least|short|weak)|weak_password/i.test(m)) return 'La contraseña es demasiado débil: mínimo 8 caracteres.';
  if (/rate limit|too many|over_email_send_rate_limit|security purposes/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
  if (/ya está en uso|23505/i.test(m)) return 'Ese alias ya está en uso.';
  if (/error sending|smtp|unexpected_failure/i.test(m)) return 'No se ha podido enviar el correo de confirmación. Inténtalo más tarde.';
  return m || 'Error desconocido';
}

// Datos del usuario actual: { id, email, anonimo, alias }
export async function usuario() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const u = session.user;
  let alias = null;
  try { alias = (await rpc('mi_perfil'))?.alias ?? null; } catch (x) { /* sin perfil */ }
  return { id: u.id, email: u.email || '', anonimo: Boolean(u.is_anonymous), alias };
}

export async function aliasDisponible(alias) { return Boolean(await rpc('alias_disponible', { p_alias: alias })); }

// Convierte la sesión anónima en cuenta con email y contraseña. Mantiene el mismo usuario, así que
// el progreso ya guardado sigue siendo suyo. Con "Confirm email" activo, el correo queda pendiente
// hasta que se pulse el enlace.
export async function registrar({ alias, email, password }) {
  try {
    await rpc('poner_alias', { p_alias: alias });
    const { data, error } = await supabase.auth.updateUser({ email, password }, { emailRedirectTo: RAIZ() });
    if (error) throw error;
    return { pendiente: !data.user.email_confirmed_at };
  } catch (e) { throw new Error(traducir(e)); }
}

export async function entrarCuenta({ email, password }) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(traducir(error));
}

export async function salirCuenta() {
  await supabase.auth.signOut();
  await sesion();
}

export async function reenviarConfirmacion(email) {
  const { error } = await supabase.auth.resend({ type: 'email_change', email, options: { emailRedirectTo: RAIZ() } });
  if (error) throw new Error(traducir(error));
}

export const api = {
  misCasos: () => rpc('mis_casos'),
  iniciar: caso => rpc('iniciar_partida', { p_caso: caso }),
  estado: partida => rpc('estado_partida', { p_partida: partida }),
  comprobar: (partida, respuesta) => rpc('comprobar_respuesta', { p_partida: partida, p_respuesta: respuesta }),
  pista: partida => rpc('pedir_pista', { p_partida: partida }),
  reiniciar: partida => rpc('reiniciar_partida', { p_partida: partida }),
};
