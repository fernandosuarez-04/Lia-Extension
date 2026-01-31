import { createClient } from '@supabase/supabase-js';
import { SOFIA_SUPABASE, CONTENT_GEN_SUPABASE } from '../config';

// Custom Storage Adapter for Chrome Extension (shared with main supabase client)
const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] || null);
        });
      } else {
        resolve(localStorage.getItem(key));
      }
    });
  },
  setItem: async (key: string, value: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      } else {
        localStorage.setItem(key, value);
        resolve();
      }
    });
  },
  removeItem: async (key: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove([key], () => resolve());
      } else {
        localStorage.removeItem(key);
        resolve();
      }
    });
  },
};

// Validate URL helper
const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// SOFIA Supabase Client (Auth Principal + Organizaciones/Equipos)
const sofiaUrl = isValidUrl(SOFIA_SUPABASE.URL) ? SOFIA_SUPABASE.URL : '';
const sofiaKey = SOFIA_SUPABASE.ANON_KEY || '';

export const sofiaSupa = sofiaUrl && sofiaKey
  ? createClient(sofiaUrl, sofiaKey, {
      auth: {
        storage: chromeStorageAdapter,
        storageKey: 'sofia-auth-token',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Content Generator Supabase Client
const contentGenUrl = isValidUrl(CONTENT_GEN_SUPABASE.URL) ? CONTENT_GEN_SUPABASE.URL : '';
const contentGenKey = CONTENT_GEN_SUPABASE.ANON_KEY || '';

export const contentGenSupa = contentGenUrl && contentGenKey
  ? createClient(contentGenUrl, contentGenKey, {
      auth: {
        storage: chromeStorageAdapter,
        storageKey: 'content-gen-auth-token',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Helper to check if SOFIA is configured
export const isSofiaConfigured = () => {
  return (
    SOFIA_SUPABASE.URL !== '' &&
    SOFIA_SUPABASE.ANON_KEY !== '' &&
    isValidUrl(SOFIA_SUPABASE.URL)
  );
};

// Helper to check if Content Generator is configured
export const isContentGenConfigured = () => {
  return (
    CONTENT_GEN_SUPABASE.URL !== '' &&
    CONTENT_GEN_SUPABASE.ANON_KEY !== '' &&
    isValidUrl(CONTENT_GEN_SUPABASE.URL)
  );
};

// ============================================
// SOFIA Types (based on actual schema)
// ============================================

// SOFIA user from `users` table
export interface SofiaUser {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  profile_picture_url?: string;
  cargo_rol?: 'Usuario' | 'Instructor' | 'Administrador' | 'Business' | 'Business User';
  phone?: string;
  bio?: string;
  location?: string;
  created_at: string;
}

// SOFIA organization from `organizations` table
export interface SofiaOrganization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  contact_email?: string;
  subscription_plan?: 'team' | 'business' | 'enterprise';
  subscription_status?: 'active' | 'expired' | 'cancelled' | 'trial' | 'pending';
  brand_color_primary?: string;
  brand_color_secondary?: string;
  is_active: boolean;
  created_at: string;
}

// SOFIA organization membership from `organization_users` table
export interface SofiaOrganizationUser {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'invited' | 'suspended' | 'removed';
  job_title?: string;
  team_id?: string;
  zone_id?: string;
  region_id?: string;
  joined_at?: string;
  organization?: SofiaOrganization;
  team?: SofiaTeam;
}

// SOFIA team from `organization_teams` table
export interface SofiaTeam {
  id: string;
  organization_id: string;
  zone_id: string;
  name: string;
  description?: string;
  code?: string;
  is_active: boolean;
}

// SOFIA user profile (combined data)
export interface SofiaUserProfile {
  id: string;
  username: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  cargo_rol?: string;
  organizations: SofiaOrganization[];
  teams: SofiaTeam[];
  memberships: SofiaOrganizationUser[];
}

// ============================================
// CourseGen Types (based on actual schema)
// ============================================

export interface CourseGenProfile {
  id: string;
  username?: string;
  email?: string;
  first_name?: string;
  last_name_father?: string;
  last_name_mother?: string;
  avatar_url?: string;
  platform_role: string;
  organization_id?: string;
}

export interface CourseGenOrganization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  is_active: boolean;
}
