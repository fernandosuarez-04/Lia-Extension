import { Session } from '@supabase/supabase-js';
import {
  sofiaSupa,
  isSofiaConfigured,
  SofiaOrganization,
  SofiaTeam,
  SofiaUserProfile,
  SofiaOrganizationUser
} from '../lib/sofia-client';

// Tipo simplificado de usuario para compatibilidad con Supabase Auth y SOFIA custom auth
export interface SofiaAuthUser {
  id: string;
  email?: string;
  user_metadata?: {
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
}

export interface SofiaAuthResult {
  success: boolean;
  user: SofiaAuthUser | null;
  session: Session | null;
  error?: string;
  sofiaProfile?: SofiaUserProfile | null;
}

export interface SofiaContext {
  user: SofiaUserProfile | null;
  currentOrganization: SofiaOrganization | null;
  currentTeam: SofiaTeam | null;
  organizations: SofiaOrganization[];
  teams: SofiaTeam[];
  memberships: SofiaOrganizationUser[];
}

class SofiaAuthService {
  private sofiaContext: SofiaContext | null = null;

  /**
   * Inicia sesion usando las credenciales de SOFIA
   * Acepta email o username. Si es username, busca el email primero.
   */
  async signInWithSofia(emailOrUsername: string, password: string): Promise<SofiaAuthResult> {
    if (!isSofiaConfigured() || !sofiaSupa) {
      return {
        success: false,
        user: null,
        session: null,
        error: 'SOFIA no esta configurado. Verifica las variables de entorno.'
      };
    }

    try {
      // SOFIA usa autenticación propia, no Supabase Auth
      // Llamar a la función RPC de autenticación
      console.log('Intentando autenticar con SOFIA:', { identifier: emailOrUsername });

      const { data: authResult, error: authError } = await sofiaSupa
        .rpc('authenticate_user', {
          p_identifier: emailOrUsername,
          p_password: password
        });

      console.log('Resultado de authenticate_user:', JSON.stringify(authResult, null, 2));

      if (authError) {
        console.error('Error llamando authenticate_user:', JSON.stringify(authError, null, 2));
        console.error('Auth error details:', {
          message: authError.message,
          code: authError.code,
          details: authError.details,
          hint: authError.hint
        });
        return {
          success: false,
          user: null,
          session: null,
          error: authError.message || 'Error de conexion con SOFIA'
        };
      }

      if (!authResult?.success) {
        return {
          success: false,
          user: null,
          session: null,
          error: authResult?.error || 'Credenciales invalidas'
        };
      }

      // Usuario autenticado exitosamente desde SOFIA
      const sofiaUser = authResult.user;

      // 2. Obtener el perfil completo del usuario desde SOFIA (orgs, teams)
      const sofiaProfile = await this.fetchSofiaUserProfile(sofiaUser.id);

      // 3. Guardar contexto de SOFIA
      this.sofiaContext = {
        user: sofiaProfile,
        currentOrganization: sofiaProfile?.organizations?.[0] || null,
        currentTeam: sofiaProfile?.teams?.[0] || null,
        organizations: sofiaProfile?.organizations || [],
        teams: sofiaProfile?.teams || [],
        memberships: sofiaProfile?.memberships || []
      };

      // 4. Guardar datos del usuario en chrome.storage para persistencia
      await this.saveSofiaSession(sofiaUser);

      // Crear un "pseudo-user" compatible con la interfaz de Supabase
      const pseudoUser = {
        id: sofiaUser.id,
        email: sofiaUser.email,
        user_metadata: {
          first_name: sofiaUser.first_name,
          last_name: sofiaUser.last_name,
          avatar_url: sofiaUser.profile_picture_url
        }
      } as any;

      return {
        success: true,
        user: pseudoUser,
        session: null, // SOFIA no usa Supabase sessions
        sofiaProfile
      };
    } catch (err: any) {
      console.error('Error en signInWithSofia:', err);
      return {
        success: false,
        user: null,
        session: null,
        error: err.message || 'Error desconocido al iniciar sesion'
      };
    }
  }

  /**
   * Obtiene el perfil completo del usuario desde SOFIA
   * usando las tablas: users, organization_users, organizations, organization_teams
   */
  async fetchSofiaUserProfile(userId: string): Promise<SofiaUserProfile | null> {
    if (!sofiaSupa) return null;

    try {
      // 1. Obtener datos del usuario desde la tabla `users`
      const { data: user, error: userError } = await sofiaSupa
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError) {
        console.warn('No se encontro usuario en SOFIA:', userError);
        return null;
      }

      // 2. Obtener membresias a organizaciones desde `organization_users`
      const { data: memberships, error: membershipsError } = await sofiaSupa
        .from('organization_users')
        .select(`
          id,
          organization_id,
          user_id,
          role,
          status,
          job_title,
          team_id,
          zone_id,
          region_id,
          joined_at,
          organizations (
            id,
            name,
            slug,
            description,
            logo_url,
            contact_email,
            subscription_plan,
            subscription_status,
            brand_color_primary,
            brand_color_secondary,
            is_active,
            created_at
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'active');

      if (membershipsError) {
        console.warn('Error obteniendo membresias:', membershipsError);
      }

      // 3. Extraer organizaciones unicas
      const organizations: SofiaOrganization[] = [];
      const orgIds = new Set<string>();

      memberships?.forEach((m: any) => {
        if (m.organizations && !orgIds.has(m.organizations.id)) {
          orgIds.add(m.organizations.id);
          organizations.push(m.organizations);
        }
      });

      // 4. Obtener equipos del usuario
      const teamIds = memberships
        ?.filter((m: any) => m.team_id)
        .map((m: any) => m.team_id) || [];

      let teams: SofiaTeam[] = [];
      if (teamIds.length > 0) {
        const { data: teamsData } = await sofiaSupa
          .from('organization_teams')
          .select('*')
          .in('id', teamIds)
          .eq('is_active', true);

        teams = teamsData || [];
      }

      // 5. Construir el perfil completo
      const fullName = user.display_name ||
        [user.first_name, user.last_name].filter(Boolean).join(' ') ||
        user.username;

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: fullName,
        avatar_url: user.profile_picture_url,
        cargo_rol: user.cargo_rol,
        organizations,
        teams,
        memberships: memberships?.map((m: any) => ({
          id: m.id,
          organization_id: m.organization_id,
          user_id: m.user_id,
          role: m.role,
          status: m.status,
          job_title: m.job_title,
          team_id: m.team_id,
          zone_id: m.zone_id,
          region_id: m.region_id,
          joined_at: m.joined_at,
          organization: m.organizations
        })) || []
      };
    } catch (err) {
      console.error('Error fetching SOFIA profile:', err);
      return null;
    }
  }

  /**
   * Guarda la sesion de SOFIA en chrome.storage
   */
  private async saveSofiaSession(user: any) {
    const sessionData = {
      user,
      timestamp: Date.now()
    };

    return new Promise<void>((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ 'sofia-session': JSON.stringify(sessionData) }, () => resolve());
      } else {
        localStorage.setItem('sofia-session', JSON.stringify(sessionData));
        resolve();
      }
    });
  }

  /**
   * Obtiene la sesion guardada de SOFIA
   */
  private async getSofiaStoredSession(): Promise<any | null> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['sofia-session'], (result) => {
          if (result['sofia-session']) {
            try {
              const session = JSON.parse(result['sofia-session']);
              // Verificar que no haya expirado (24 horas)
              if (Date.now() - session.timestamp < 24 * 60 * 60 * 1000) {
                resolve(session.user);
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      } else {
        const stored = localStorage.getItem('sofia-session');
        if (stored) {
          try {
            const session = JSON.parse(stored);
            if (Date.now() - session.timestamp < 24 * 60 * 60 * 1000) {
              resolve(session.user);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      }
    });
  }

  /**
   * Cierra sesion en SOFIA y limpia el contexto
   */
  async signOut() {
    // Limpiar sesion guardada
    return new Promise<void>((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(['sofia-session'], () => {
          this.sofiaContext = null;
          resolve();
        });
      } else {
        localStorage.removeItem('sofia-session');
        this.sofiaContext = null;
        resolve();
      }
    });
  }

  /**
   * Obtiene la sesion actual de SOFIA (para compatibilidad)
   * Retorna un pseudo-session si hay usuario guardado
   */
  async getSession(): Promise<Session | null> {
    const storedUser = await this.getSofiaStoredSession();
    if (storedUser) {
      // Retornar un pseudo-session con el usuario
      return {
        user: {
          id: storedUser.id,
          email: storedUser.email,
          user_metadata: {
            first_name: storedUser.first_name,
            last_name: storedUser.last_name,
            avatar_url: storedUser.profile_picture_url
          }
        }
      } as any;
    }
    return null;
  }

  /**
   * Obtiene el contexto actual de SOFIA (user, org, team)
   */
  getSofiaContext(): SofiaContext | null {
    return this.sofiaContext;
  }

  /**
   * Cambia la organizacion activa del usuario
   */
  setCurrentOrganization(org: SofiaOrganization) {
    if (this.sofiaContext) {
      this.sofiaContext.currentOrganization = org;
      // Filtrar equipos de esta organizacion
      this.sofiaContext.currentTeam = this.sofiaContext.teams.find(
        t => t.organization_id === org.id
      ) || null;
    }
  }

  /**
   * Cambia el equipo activo del usuario
   */
  setCurrentTeam(team: SofiaTeam) {
    if (this.sofiaContext) {
      this.sofiaContext.currentTeam = team;
    }
  }

  /**
   * Escucha cambios en el estado de autenticacion de SOFIA
   * Como usamos autenticación propia, esto es un stub que verifica la sesion guardada
   */
  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    // Verificar sesion al iniciar
    this.getSession().then(session => {
      if (session) {
        callback('INITIAL_SESSION', session);
      }
    });

    // Retornar un subscription stub (no hay eventos reales sin Supabase Auth)
    return {
      data: {
        subscription: {
          unsubscribe: () => {}
        }
      }
    };
  }
}

export const sofiaAuth = new SofiaAuthService();
