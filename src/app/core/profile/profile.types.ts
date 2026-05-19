export interface Profile {
  sub: string;
  handle: string;
  createdAt: string;
  updatedAt: string;
  /** True when the profile is a client-side synthetic (Mongo not configured). */
  synthetic?: boolean;
}

export type ProfileErrorCode =
  | 'no-profile'
  | 'mongo-not-configured'
  | 'handle-taken'
  | 'invalid-handle'
  | 'network'
  | 'unknown';

export interface ProfileError {
  code: ProfileErrorCode;
  detail?: string;
}
