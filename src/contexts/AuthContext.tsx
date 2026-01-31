import React, { createContext, useState, useEffect, useContext } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isSofiaConfigured } from '../lib/sofia-client';
import { sofiaAuth, SofiaContext, SofiaAuthResult, SofiaAuthUser } from '../services/sofia-auth';

// Tipo de usuario flexible que funciona con Supabase Auth y SOFIA custom auth
type AuthUser = SofiaAuthUser | null;

interface AuthContextType {
  session: Session | null;
  user: AuthUser;
  loading: boolean;
  signOut: () => Promise<void>;
  // SOFIA Integration
  usingSofia: boolean;
  sofiaContext: SofiaContext | null;
  signInWithSofia: (email: string, password: string) => Promise<SofiaAuthResult>;
  setCurrentOrganization: (orgId: string) => void;
  setCurrentTeam: (teamId: string) => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
  // SOFIA defaults
  usingSofia: false,
  sofiaContext: null,
  signInWithSofia: async () => ({ success: false, user: null, session: null, error: 'Not initialized' }),
  setCurrentOrganization: () => {},
  setCurrentTeam: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);
  const [sofiaContext, setSofiaContext] = useState<SofiaContext | null>(null);

  // Determinar si usar SOFIA para autenticación
  const usingSofia = isSofiaConfigured();

  useEffect(() => {
    const initSession = async () => {
      try {
        if (usingSofia) {
          // Usar SOFIA como auth principal
          const sofiaSession = await sofiaAuth.getSession();
          if (sofiaSession) {
            // También verificar si hay sesión en Lia Supabase (para conversaciones)
            const { data: { session: liaSession } } = await supabase.auth.getSession();

            if (liaSession) {
              // Ambas sesiones existen - usar Lia para conversaciones
              console.log('initSession: Ambas sesiones activas (SOFIA + Lia)');
              setSession(liaSession);
              setUser({
                id: liaSession.user.id,
                email: liaSession.user.email,
                user_metadata: sofiaSession.user.user_metadata
              });

              // Cargar contexto de SOFIA (orgs, teams)
              const profile = await sofiaAuth.fetchSofiaUserProfile(sofiaSession.user.id);
              if (profile) {
                setSofiaContext({
                  user: profile,
                  currentOrganization: profile.organizations?.[0] || null,
                  currentTeam: profile.teams?.[0] || null,
                  organizations: profile.organizations || [],
                  teams: profile.teams || [],
                  memberships: profile.memberships || []
                });
              }
            } else {
              // SOFIA existe pero Lia no - forzar re-login para sincronizar
              console.log('initSession: SOFIA session sin Lia session - requiere re-login');
              await sofiaAuth.signOut();
              // No establecer user - mostrará login
            }
          }
        } else {
          // Fallback: usar Lia Supabase directamente
          const { data: { session } } = await supabase.auth.getSession();
          setSession(session);
          // Convertir User de Supabase a nuestro tipo
          setUser(session?.user ? {
            id: session.user.id,
            email: session.user.email,
            user_metadata: session.user.user_metadata
          } : null);
        }
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setLoading(false);
      }
    };

    initSession();

    // Escuchar cambios en la autenticación
    let unsubscribe: (() => void) | undefined;

    if (usingSofia) {
      const { data: { subscription } } = sofiaAuth.onAuthStateChange(
        async (event, session) => {
          console.log('SOFIA Auth state changed:', event);
          setSession(session);
          // El session de SOFIA ya tiene user en formato SofiaAuthUser
          setUser(session?.user ?? null);

          if (session?.user) {
            const profile = await sofiaAuth.fetchSofiaUserProfile(session.user.id);
            if (profile) {
              setSofiaContext({
                user: profile,
                currentOrganization: profile.organizations?.[0] || null,
                currentTeam: profile.teams?.[0] || null,
                organizations: profile.organizations || [],
                teams: profile.teams || [],
                memberships: profile.memberships || []
              });
            }
          } else {
            setSofiaContext(null);
          }

          setLoading(false);
        }
      );
      unsubscribe = subscription.unsubscribe;
    } else {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          console.log('Auth state changed:', _event);
          setSession(session);
          // Convertir User de Supabase a nuestro tipo
          setUser(session?.user ? {
            id: session.user.id,
            email: session.user.email,
            user_metadata: session.user.user_metadata
          } : null);
          setLoading(false);
        }
      );
      unsubscribe = subscription.unsubscribe;
    }

    return () => {
      unsubscribe?.();
    };
  }, [usingSofia]);

  const signOut = async () => {
    if (usingSofia) {
      await sofiaAuth.signOut();
      setSofiaContext(null);
      // Limpiar estados locales para SOFIA
      setUser(null);
      setSession(null);
    }
    await supabase.auth.signOut();
  };

  const signInWithSofia = async (emailOrUsername: string, password: string): Promise<SofiaAuthResult> => {
    const result = await sofiaAuth.signInWithSofia(emailOrUsername, password);

    console.log('signInWithSofia result:', result);

    // SOFIA no usa sessions de Supabase, solo verificamos success y user
    if (result.success && result.user) {
      // También autenticar en Lia Supabase para que funcionen las conversaciones (RLS)
      const sofiaEmail = result.user.email || result.sofiaProfile?.email;
      if (sofiaEmail) {
        try {
          // Intentar iniciar sesión en Lia Supabase
          const { data: liaAuth, error: liaError } = await supabase.auth.signInWithPassword({
            email: sofiaEmail,
            password: password // Usar la misma contraseña
          });

          if (liaError) {
            // Si no existe, crear cuenta en Lia Supabase
            console.log('Usuario no existe en Lia, creando...', liaError.message);
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
              email: sofiaEmail,
              password: password,
              options: {
                data: {
                  full_name: result.sofiaProfile?.full_name || result.user.user_metadata?.first_name,
                  sofia_user_id: result.user.id
                }
              }
            });

            if (signUpError) {
              console.error('Error creando usuario en Lia:', signUpError);
            } else if (signUpData.session) {
              console.log('Usuario creado en Lia Supabase');
              setSession(signUpData.session);
              // Usar el ID de Lia para las conversaciones
              setUser({
                id: signUpData.user!.id,
                email: sofiaEmail,
                user_metadata: result.user.user_metadata
              });
            } else {
              // Email confirmation requerido - usar ID de SOFIA temporalmente
              console.log('Email confirmation requerido, usando SOFIA user');
              setUser(result.user);
            }
          } else if (liaAuth.session) {
            console.log('Sesión de Lia Supabase establecida');
            setSession(liaAuth.session);
            // Usar el ID de Lia para las conversaciones
            setUser({
              id: liaAuth.user!.id,
              email: sofiaEmail,
              user_metadata: result.user.user_metadata
            });
          }
        } catch (err) {
          console.error('Error sincronizando con Lia Supabase:', err);
          setUser(result.user);
        }
      } else {
        setUser(result.user);
      }

      if (result.sofiaProfile) {
        setSofiaContext({
          user: result.sofiaProfile,
          currentOrganization: result.sofiaProfile.organizations?.[0] || null,
          currentTeam: result.sofiaProfile.teams?.[0] || null,
          organizations: result.sofiaProfile.organizations || [],
          teams: result.sofiaProfile.teams || [],
          memberships: result.sofiaProfile.memberships || []
        });
      }
    }

    return result;
  };

  const setCurrentOrganization = (orgId: string) => {
    if (sofiaContext) {
      const org = sofiaContext.organizations.find(o => o.id === orgId);
      if (org) {
        sofiaAuth.setCurrentOrganization(org);
        setSofiaContext(prev => prev ? {
          ...prev,
          currentOrganization: org,
          currentTeam: prev.teams.find(t => t.organization_id === org.id) || null
        } : null);
      }
    }
  };

  const setCurrentTeam = (teamId: string) => {
    if (sofiaContext) {
      const team = sofiaContext.teams.find(t => t.id === teamId);
      if (team) {
        sofiaAuth.setCurrentTeam(team);
        setSofiaContext(prev => prev ? { ...prev, currentTeam: team } : null);
      }
    }
  };

  const value = {
    session,
    user,
    loading,
    signOut,
    usingSofia,
    sofiaContext,
    signInWithSofia,
    setCurrentOrganization,
    setCurrentTeam,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  return useContext(AuthContext);
};
