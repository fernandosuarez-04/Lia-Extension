-- =============================================
-- IRIS - Collaboration & Project Management Schema
-- Fixed: ARRAY syntax errors and table ordering
-- =============================================

-- 1. account_users (no FK dependencies)
CREATE TABLE public.account_users (
  user_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  first_name character varying NOT NULL,
  last_name_paternal character varying NOT NULL,
  last_name_maternal character varying,
  display_name character varying,
  username character varying NOT NULL UNIQUE CHECK (username::text ~* '^[A-Za-z0-9_-]{3,50}$'::text),
  email character varying NOT NULL UNIQUE CHECK (email::text ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'::text),
  password_hash text NOT NULL CHECK (password_hash IS NOT NULL AND length(password_hash) > 0),
  permission_level character varying NOT NULL DEFAULT 'user'::character varying CHECK (permission_level::text = ANY (ARRAY['super_admin'::character varying, 'admin'::character varying, 'manager'::character varying, 'user'::character varying, 'viewer'::character varying, 'guest'::character varying]::text[])),
  company_role character varying,
  department character varying,
  account_status character varying NOT NULL DEFAULT 'active'::character varying CHECK (account_status::text = ANY (ARRAY['active'::character varying, 'inactive'::character varying, 'suspended'::character varying, 'pending_verification'::character varying, 'deleted'::character varying]::text[])),
  is_email_verified boolean NOT NULL DEFAULT false,
  email_verified_at timestamp with time zone,
  avatar_url text,
  phone_number character varying,
  timezone character varying DEFAULT 'America/Mexico_City'::character varying,
  locale character varying DEFAULT 'es-MX'::character varying,
  last_login_at timestamp with time zone,
  last_activity_at timestamp with time zone,
  failed_login_attempts integer DEFAULT 0,
  locked_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT account_users_pkey PRIMARY KEY (user_id)
);

-- 2. teams (depends on: account_users)
CREATE TABLE public.teams (
  team_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name character varying NOT NULL,
  slug character varying NOT NULL UNIQUE,
  description text,
  avatar_url text,
  color character varying DEFAULT '#00D4B3'::character varying,
  status character varying NOT NULL DEFAULT 'active'::character varying CHECK (status::text = ANY (ARRAY['active'::character varying::text, 'archived'::character varying::text, 'suspended'::character varying::text])),
  visibility character varying NOT NULL DEFAULT 'private'::character varying CHECK (visibility::text = ANY (ARRAY['public'::character varying::text, 'private'::character varying::text, 'internal'::character varying::text])),
  owner_id uuid NOT NULL,
  max_members integer DEFAULT 50,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT teams_pkey PRIMARY KEY (team_id),
  CONSTRAINT teams_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.account_users(user_id)
);

-- 3. team_members (depends on: teams, account_users)
CREATE TABLE public.team_members (
  member_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role character varying NOT NULL DEFAULT 'member'::character varying CHECK (role::text = ANY (ARRAY['owner'::character varying::text, 'admin'::character varying::text, 'moderator'::character varying::text, 'member'::character varying::text, 'viewer'::character varying::text])),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  invited_by uuid,
  invitation_accepted_at timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  last_activity_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT team_members_pkey PRIMARY KEY (member_id),
  CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id),
  CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id),
  CONSTRAINT team_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.account_users(user_id)
);

-- 4. aria_chat_attachments (depends on: account_users)
CREATE TABLE public.aria_chat_attachments (
  attachment_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  team_id uuid,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer,
  storage_path text NOT NULL,
  public_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT aria_chat_attachments_pkey PRIMARY KEY (attachment_id),
  CONSTRAINT aria_chat_attachments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id)
);

-- 5. aria_usage_logs (depends on: account_users, teams)
CREATE TABLE public.aria_usage_logs (
  log_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  team_id uuid,
  model character varying NOT NULL,
  input_tokens integer DEFAULT 0,
  output_tokens integer DEFAULT 0,
  total_tokens integer DEFAULT 0,
  interaction_type character varying DEFAULT 'chat'::character varying,
  status character varying DEFAULT 'success'::character varying,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT aria_usage_logs_pkey PRIMARY KEY (log_id),
  CONSTRAINT aria_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id),
  CONSTRAINT aria_usage_logs_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id)
);

-- 6. auth_email_verifications (depends on: account_users)
CREATE TABLE public.auth_email_verifications (
  verification_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  email character varying NOT NULL,
  token_hash text NOT NULL UNIQUE,
  is_verified boolean NOT NULL DEFAULT false,
  verified_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auth_email_verifications_pkey PRIMARY KEY (verification_id),
  CONSTRAINT auth_email_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id)
);

-- 7. auth_login_history (depends on: account_users)
CREATE TABLE public.auth_login_history (
  log_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  login_identifier character varying NOT NULL,
  login_status character varying NOT NULL CHECK (login_status::text = ANY (ARRAY['success'::character varying, 'failed_password'::character varying, 'failed_user_not_found'::character varying, 'account_locked'::character varying, 'account_suspended'::character varying, 'mfa_required'::character varying, 'mfa_failed'::character varying]::text[])),
  failure_reason text,
  ip_address inet,
  user_agent text,
  device_fingerprint text,
  geo_country character varying,
  geo_city character varying,
  attempted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auth_login_history_pkey PRIMARY KEY (log_id),
  CONSTRAINT auth_login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id)
);

-- 8. auth_oauth_providers (depends on: account_users)
-- FIX: granted_scopes ARRAY -> text[]
CREATE TABLE public.auth_oauth_providers (
  oauth_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  provider_name character varying NOT NULL CHECK (provider_name::text = ANY (ARRAY['google'::character varying, 'microsoft'::character varying, 'github'::character varying, 'linkedin'::character varying, 'apple'::character varying]::text[])),
  provider_user_id character varying NOT NULL,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamp with time zone,
  provider_email character varying,
  provider_display_name character varying,
  provider_avatar_url text,
  granted_scopes text[],
  linked_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auth_oauth_providers_pkey PRIMARY KEY (oauth_id),
  CONSTRAINT auth_oauth_providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id)
);

-- 9. auth_password_resets (depends on: account_users)
CREATE TABLE public.auth_password_resets (
  reset_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  ip_address inet,
  user_agent text,
  is_used boolean NOT NULL DEFAULT false,
  used_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auth_password_resets_pkey PRIMARY KEY (reset_id),
  CONSTRAINT auth_password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id)
);

-- 10. auth_sessions (depends on: account_users)
CREATE TABLE public.auth_sessions (
  session_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  refresh_token_hash text UNIQUE,
  device_fingerprint text,
  device_type character varying,
  browser_name character varying,
  browser_version character varying,
  operating_system character varying,
  ip_address inet,
  user_agent text,
  geo_country character varying,
  geo_city character varying,
  is_active boolean NOT NULL DEFAULT true,
  is_revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamp with time zone,
  revoked_reason text,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  last_used_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id)
);

-- 11. auth_refresh_tokens (depends on: account_users, auth_sessions)
CREATE TABLE public.auth_refresh_tokens (
  token_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  session_id uuid,
  token_hash text NOT NULL UNIQUE,
  token_family uuid NOT NULL DEFAULT uuid_generate_v4(),
  device_fingerprint text,
  ip_address inet,
  user_agent text,
  is_revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamp with time zone,
  revoked_reason text,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auth_refresh_tokens_pkey PRIMARY KEY (token_id),
  CONSTRAINT auth_refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id),
  CONSTRAINT auth_refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.auth_sessions(session_id)
);

-- 12. faqs (no FK dependencies)
CREATE TABLE public.faqs (
  faq_id uuid NOT NULL DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category character varying DEFAULT 'general'::character varying,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT faqs_pkey PRIMARY KEY (faq_id)
);

-- 13. focus_sessions (depends on: auth.users)
-- FIX: target_ids ARRAY -> text[]
CREATE TABLE public.focus_sessions (
  session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  task_name text,
  start_time timestamp with time zone DEFAULT now(),
  end_time timestamp with time zone NOT NULL,
  duration_minutes integer NOT NULL,
  target_type character varying CHECK (target_type::text = ANY (ARRAY['global'::character varying, 'team'::character varying, 'users'::character varying]::text[])),
  target_ids text[],
  status character varying DEFAULT 'active'::character varying CHECK (status::text = ANY (ARRAY['active'::character varying, 'completed'::character varying, 'cancelled'::character varying]::text[])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT focus_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT focus_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

-- 14. notifications (depends on: account_users)
CREATE TABLE public.notifications (
  notification_id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  actor_id uuid,
  title text NOT NULL,
  message text,
  type character varying DEFAULT 'info'::character varying,
  category character varying DEFAULT 'system'::character varying,
  entity_id uuid,
  link text,
  is_read boolean DEFAULT false,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notifications_pkey PRIMARY KEY (notification_id),
  CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.account_users(user_id),
  CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.account_users(user_id)
);

-- 15. pm_projects (depends on: teams, account_users)
-- FIX: tags ARRAY -> text[]
CREATE TABLE public.pm_projects (
  project_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_key character varying NOT NULL UNIQUE,
  project_name character varying NOT NULL,
  project_description text,
  icon_name character varying DEFAULT 'folder'::character varying,
  icon_color character varying DEFAULT '#3B82F6'::character varying,
  cover_image_url text,
  project_status character varying NOT NULL DEFAULT 'planning'::character varying CHECK (project_status::text = ANY (ARRAY['planning'::character varying, 'active'::character varying, 'on_hold'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'archived'::character varying]::text[])),
  health_status character varying NOT NULL DEFAULT 'none'::character varying CHECK (health_status::text = ANY (ARRAY['on_track'::character varying, 'at_risk'::character varying, 'off_track'::character varying, 'none'::character varying]::text[])),
  priority_level character varying NOT NULL DEFAULT 'medium'::character varying CHECK (priority_level::text = ANY (ARRAY['urgent'::character varying, 'high'::character varying, 'medium'::character varying, 'low'::character varying, 'none'::character varying]::text[])),
  completion_percentage integer NOT NULL DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
  start_date date,
  target_date date,
  actual_end_date date,
  team_id uuid,
  lead_user_id uuid,
  created_by_user_id uuid NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  is_template boolean NOT NULL DEFAULT false,
  allow_external_access boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  tags text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone,
  CONSTRAINT pm_projects_pkey PRIMARY KEY (project_id),
  CONSTRAINT pm_projects_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id),
  CONSTRAINT pm_projects_lead_user_id_fkey FOREIGN KEY (lead_user_id) REFERENCES public.account_users(user_id),
  CONSTRAINT pm_projects_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.account_users(user_id)
);

-- 16. pm_milestones (depends on: pm_projects)
CREATE TABLE public.pm_milestones (
  milestone_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL,
  milestone_name character varying NOT NULL,
  milestone_description text,
  milestone_status character varying NOT NULL DEFAULT 'pending'::character varying CHECK (milestone_status::text = ANY (ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'missed'::character varying, 'cancelled'::character varying]::text[])),
  target_date date NOT NULL,
  completed_date date,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pm_milestones_pkey PRIMARY KEY (milestone_id),
  CONSTRAINT pm_milestones_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.pm_projects(project_id)
);

-- 17. pm_project_members (depends on: pm_projects, account_users)
CREATE TABLE public.pm_project_members (
  member_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  project_role character varying NOT NULL DEFAULT 'member'::character varying CHECK (project_role::text = ANY (ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying, 'viewer'::character varying, 'guest'::character varying]::text[])),
  can_edit boolean NOT NULL DEFAULT true,
  can_delete boolean NOT NULL DEFAULT false,
  can_manage_members boolean NOT NULL DEFAULT false,
  can_manage_settings boolean NOT NULL DEFAULT false,
  notification_preference character varying DEFAULT 'all'::character varying CHECK (notification_preference::text = ANY (ARRAY['all'::character varying, 'mentions'::character varying, 'important'::character varying, 'none'::character varying]::text[])),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  invited_by_user_id uuid,
  CONSTRAINT pm_project_members_pkey PRIMARY KEY (member_id),
  CONSTRAINT pm_project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.pm_projects(project_id),
  CONSTRAINT pm_project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id),
  CONSTRAINT pm_project_members_invited_by_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.account_users(user_id)
);

-- 18. pm_project_progress_history (depends on: pm_projects)
CREATE TABLE public.pm_project_progress_history (
  history_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL,
  completion_percentage integer NOT NULL CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
  total_tasks integer DEFAULT 0,
  completed_tasks integer DEFAULT 0,
  in_progress_tasks integer DEFAULT 0,
  blocked_tasks integer DEFAULT 0,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pm_project_progress_history_pkey PRIMARY KEY (history_id),
  CONSTRAINT pm_project_progress_history_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.pm_projects(project_id)
);

-- 19. pm_project_updates (depends on: pm_projects, account_users)
CREATE TABLE public.pm_project_updates (
  update_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  update_title character varying,
  update_content text NOT NULL,
  update_type character varying NOT NULL DEFAULT 'general'::character varying CHECK (update_type::text = ANY (ARRAY['general'::character varying, 'status'::character varying, 'milestone'::character varying, 'blocker'::character varying, 'decision'::character varying, 'celebration'::character varying]::text[])),
  health_status_snapshot character varying CHECK (health_status_snapshot::text = ANY (ARRAY['on_track'::character varying, 'at_risk'::character varying, 'off_track'::character varying, 'none'::character varying]::text[])),
  completion_percentage_snapshot integer,
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  edited_at timestamp with time zone,
  CONSTRAINT pm_project_updates_pkey PRIMARY KEY (update_id),
  CONSTRAINT pm_project_updates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.pm_projects(project_id),
  CONSTRAINT pm_project_updates_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.account_users(user_id)
);

-- 20. pm_project_views (depends on: account_users, teams)
CREATE TABLE public.pm_project_views (
  view_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  team_id uuid,
  view_name character varying NOT NULL,
  view_description text,
  view_type character varying NOT NULL DEFAULT 'list'::character varying CHECK (view_type::text = ANY (ARRAY['list'::character varying, 'board'::character varying, 'timeline'::character varying, 'calendar'::character varying, 'table'::character varying]::text[])),
  filters jsonb DEFAULT '{}'::jsonb,
  sort_config jsonb DEFAULT '{"field": "created_at", "direction": "desc"}'::jsonb,
  columns_config jsonb DEFAULT '[]'::jsonb,
  group_by character varying,
  is_default boolean NOT NULL DEFAULT false,
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pm_project_views_pkey PRIMARY KEY (view_id),
  CONSTRAINT pm_project_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id),
  CONSTRAINT pm_project_views_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id)
);

-- 21. task_cycles (depends on: teams, account_users)
CREATE TABLE public.task_cycles (
  cycle_id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  name character varying NOT NULL,
  description text,
  number integer,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status character varying NOT NULL DEFAULT 'upcoming'::character varying CHECK (status::text = ANY (ARRAY['upcoming'::character varying, 'current'::character varying, 'completed'::character varying]::text[])),
  scope_total integer DEFAULT 0,
  scope_completed integer DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_cycles_pkey PRIMARY KEY (cycle_id),
  CONSTRAINT task_cycles_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id),
  CONSTRAINT task_cycles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.account_users(user_id)
);

-- 22. task_priorities (no FK dependencies)
CREATE TABLE public.task_priorities (
  priority_id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  level integer NOT NULL UNIQUE,
  color character varying NOT NULL,
  icon character varying,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_priorities_pkey PRIMARY KEY (priority_id)
);

-- 23. task_statuses (depends on: teams)
CREATE TABLE public.task_statuses (
  status_id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  name character varying NOT NULL,
  description text,
  color character varying DEFAULT '#6B7280'::character varying,
  icon character varying,
  status_type character varying NOT NULL CHECK (status_type::text = ANY (ARRAY['backlog'::character varying, 'todo'::character varying, 'in_progress'::character varying, 'in_review'::character varying, 'done'::character varying, 'cancelled'::character varying]::text[])),
  position integer NOT NULL DEFAULT 0,
  is_default boolean DEFAULT false,
  is_closed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_statuses_pkey PRIMARY KEY (status_id),
  CONSTRAINT task_statuses_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id)
);

-- 24. task_labels (depends on: teams, account_users)
CREATE TABLE public.task_labels (
  label_id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  name character varying NOT NULL,
  description text,
  color character varying NOT NULL DEFAULT '#6366F1'::character varying,
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_labels_pkey PRIMARY KEY (label_id),
  CONSTRAINT task_labels_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id),
  CONSTRAINT task_labels_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.account_users(user_id)
);

-- 25. task_issues (depends on: teams, task_statuses, task_priorities, task_cycles, account_users)
CREATE TABLE public.task_issues (
  issue_id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  issue_number integer NOT NULL,
  title character varying NOT NULL,
  description text,
  description_html text,
  status_id uuid NOT NULL,
  priority_id uuid,
  project_id uuid,
  cycle_id uuid,
  parent_issue_id uuid,
  assignee_id uuid,
  creator_id uuid NOT NULL,
  due_date date,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  estimate_points integer,
  estimate_hours numeric,
  time_spent_minutes integer DEFAULT 0,
  sort_order numeric DEFAULT 0,
  url_slug character varying,
  external_links jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  archived_at timestamp with time zone,
  CONSTRAINT task_issues_pkey PRIMARY KEY (issue_id),
  CONSTRAINT task_issues_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id),
  CONSTRAINT task_issues_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.task_statuses(status_id),
  CONSTRAINT task_issues_priority_id_fkey FOREIGN KEY (priority_id) REFERENCES public.task_priorities(priority_id),
  CONSTRAINT task_issues_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.task_cycles(cycle_id),
  CONSTRAINT task_issues_parent_issue_id_fkey FOREIGN KEY (parent_issue_id) REFERENCES public.task_issues(issue_id),
  CONSTRAINT task_issues_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.account_users(user_id),
  CONSTRAINT task_issues_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.account_users(user_id)
);

-- 26. task_issue_comments (depends on: task_issues, account_users)
CREATE TABLE public.task_issue_comments (
  comment_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL,
  parent_comment_id uuid,
  body text NOT NULL,
  body_html text,
  author_id uuid NOT NULL,
  reactions jsonb DEFAULT '{}'::jsonb,
  edited_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamp with time zone,
  CONSTRAINT task_issue_comments_pkey PRIMARY KEY (comment_id),
  CONSTRAINT task_issue_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.task_issue_comments(comment_id),
  CONSTRAINT task_issue_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.account_users(user_id),
  CONSTRAINT task_issue_comments_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.task_issues(issue_id)
);

-- 27. task_issue_attachments (depends on: task_issues, task_issue_comments, account_users)
CREATE TABLE public.task_issue_attachments (
  attachment_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL,
  comment_id uuid,
  file_name character varying NOT NULL,
  file_type character varying,
  file_size integer,
  storage_url text NOT NULL,
  thumbnail_url text,
  uploaded_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_issue_attachments_pkey PRIMARY KEY (attachment_id),
  CONSTRAINT task_issue_attachments_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.task_issue_comments(comment_id),
  CONSTRAINT task_issue_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.account_users(user_id),
  CONSTRAINT task_issue_attachments_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.task_issues(issue_id)
);

-- 28. task_issue_history (depends on: task_issues, account_users)
CREATE TABLE public.task_issue_history (
  history_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  field_name character varying NOT NULL,
  old_value text,
  new_value text,
  old_value_id uuid,
  new_value_id uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_issue_history_pkey PRIMARY KEY (history_id),
  CONSTRAINT task_issue_history_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.task_issues(issue_id),
  CONSTRAINT task_issue_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.account_users(user_id)
);

-- 29. task_issue_labels (depends on: task_issues, task_labels)
CREATE TABLE public.task_issue_labels (
  issue_id uuid NOT NULL,
  label_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_issue_labels_pkey PRIMARY KEY (issue_id, label_id),
  CONSTRAINT task_issue_labels_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.task_issues(issue_id),
  CONSTRAINT task_issue_labels_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.task_labels(label_id)
);

-- 30. task_issue_relations (depends on: task_issues, account_users)
CREATE TABLE public.task_issue_relations (
  relation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_issue_id uuid NOT NULL,
  target_issue_id uuid NOT NULL,
  relation_type character varying NOT NULL CHECK (relation_type::text = ANY (ARRAY['blocks'::character varying, 'is_blocked_by'::character varying, 'relates_to'::character varying, 'duplicates'::character varying, 'is_duplicated_by'::character varying]::text[])),
  created_by uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_issue_relations_pkey PRIMARY KEY (relation_id),
  CONSTRAINT task_issue_relations_source_issue_id_fkey FOREIGN KEY (source_issue_id) REFERENCES public.task_issues(issue_id),
  CONSTRAINT task_issue_relations_target_issue_id_fkey FOREIGN KEY (target_issue_id) REFERENCES public.task_issues(issue_id),
  CONSTRAINT task_issue_relations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.account_users(user_id)
);

-- 31. task_issue_subscribers (depends on: task_issues, account_users)
CREATE TABLE public.task_issue_subscribers (
  issue_id uuid NOT NULL,
  user_id uuid NOT NULL,
  subscription_type character varying DEFAULT 'all'::character varying CHECK (subscription_type::text = ANY (ARRAY['all'::character varying, 'mentions'::character varying, 'status_change'::character varying]::text[])),
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_issue_subscribers_pkey PRIMARY KEY (issue_id, user_id),
  CONSTRAINT task_issue_subscribers_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.task_issues(issue_id),
  CONSTRAINT task_issue_subscribers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id)
);

-- 32. task_saved_views (depends on: teams, account_users)
CREATE TABLE public.task_saved_views (
  view_id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  name character varying NOT NULL,
  description text,
  icon character varying,
  color character varying,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_config jsonb DEFAULT '{}'::jsonb,
  is_shared boolean DEFAULT false,
  created_by uuid,
  position integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_saved_views_pkey PRIMARY KEY (view_id),
  CONSTRAINT task_saved_views_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id),
  CONSTRAINT task_saved_views_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.account_users(user_id)
);

-- 33. user_permissions (depends on: account_users)
CREATE TABLE public.user_permissions (
  permission_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  permission_key character varying NOT NULL,
  permission_value jsonb DEFAULT '{}'::jsonb,
  granted_by uuid,
  granted_reason text,
  is_temporary boolean DEFAULT false,
  expires_at timestamp with time zone,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_permissions_pkey PRIMARY KEY (permission_id),
  CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_users(user_id),
  CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.account_users(user_id)
);