import { validatedCaptchaToken } from './captcha';
import { supabase } from '../lib/supabase';
import { applicationOrigin } from '../lib/deployment';

export type StudentRegistration = {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptedTerms: boolean;
};
export function validateRegistration(input: StudentRegistration) {
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const email = input.email.trim().toLowerCase();
  if (fullName.length < 2 || fullName.length > 120 || /[\u0000-\u001f\u007f]/.test(fullName))
    throw Error('Enter your full name using 2 to 120 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error('Enter a valid email address that you can verify.');
  if (input.password.length < 12 || input.password.length > 128)
    throw Error('Use a password of 12 to 128 characters.');
  if (input.password !== input.confirmPassword) throw Error('Both passwords must match.');
  if (!input.acceptedTerms) throw Error('Accept the service terms and privacy notice to continue.');
  return { fullName, email, password: input.password };
}
export class RegistrationRequestError extends Error {
  constructor(
    message: string,
    readonly retryDelaySeconds = 0,
  ) {
    super(message);
    this.name = 'RegistrationRequestError';
  }
}

function signupError(error: { code?: string; status?: number }) {
  if (error.code === 'over_email_send_rate_limit')
    return new RegistrationRequestError(
      'Verification emails have reached the portal’s hourly limit. Please try again later, or contact the coordinator. Existing accounts can still sign in. A short wait may not clear this limit.',
      300,
    );
  if (error.status === 429 || error.code?.includes('rate_limit'))
    return new RegistrationRequestError(
      'Too many authentication requests. Please pause before trying again. The retry timer prevents repeated requests; it does not guarantee that the service limit has cleared.',
      300,
    );
  if (error.code === 'weak_password')
    return new RegistrationRequestError('Choose a stronger password of at least 12 characters.');
  if (error.code === 'signup_disabled')
    return new RegistrationRequestError(
      'Student registration is temporarily unavailable. Please contact the coordinator.',
    );
  return new RegistrationRequestError(
    'Registration could not be completed. Try again later, or sign in if you already have an account.',
  );
}
export async function registerStudent(input: StudentRegistration, captchaToken?: string) {
  const { fullName, email, password } = validateRegistration(input);
  if (!supabase) throw Error('Student registration requires the connected portal.');
  const token = validatedCaptchaToken(captchaToken);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(token ? { captchaToken: token } : {}),
      emailRedirectTo: applicationOrigin() + '/auth/confirm',
      data: { full_name: fullName, registration_source: 'student_self_service_v1' },
    },
  });
  if (error) throw signupError(error);
  // A public signup never supplies a privileged role, an enrollment override or an auto-confirm flag.
  return { email, verificationRequired: !data.session };
}
export async function resendStudentConfirmation(email: string, captchaToken?: string) {
  if (!supabase) throw Error('Email verification is unavailable.');
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
    throw Error('Enter a valid email address.');
  const token = validatedCaptchaToken(captchaToken);
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalized,
    options: {
      emailRedirectTo: applicationOrigin() + '/auth/confirm',
      ...(token ? { captchaToken: token } : {}),
    },
  });
  if (error) throw signupError(error);
}

export async function verifyStudentEmailCode(email: string, code: string, captchaToken?: string) {
  const normalized = email.trim().toLowerCase();
  const token = code.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
    throw Error('Enter the email address you used to register.');
  if (!/^\d{6,10}$/.test(token)) throw Error('Enter the verification code from your latest email.');
  if (!supabase) throw Error('Email verification requires the connected portal.');
  const captcha = validatedCaptchaToken(captchaToken);
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalized,
    token,
    type: 'signup',
    ...(captcha ? { options: { captchaToken: captcha } } : {}),
  });
  if (error?.status === 429 || error?.code?.includes('rate_limit'))
    throw new RegistrationRequestError(
      'Too many verification attempts. Wait before trying again.',
      300,
    );
  if (error || !data.session || !data.user?.email_confirmed_at)
    throw Error(
      'This code is incorrect, expired or already used. Use the latest email or request a new one.',
    );
}

// The fragment is never sent to the web server. Only an explicit form submission
// exchanges this one-time proof; mail scanners cannot consume it with a GET.
export async function verifyStudentEmailLink(tokenHash: string, captchaToken?: string) {
  if (!/^[a-f0-9]{40,128}$/i.test(tokenHash)) throw Error('This verification link is invalid.');
  if (!supabase) throw Error('Email verification requires the connected portal.');
  const captcha = validatedCaptchaToken(captchaToken);
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'signup',
    ...(captcha ? { options: { captchaToken: captcha } } : {}),
  });
  if (error?.status === 429 || error?.code?.includes('rate_limit'))
    throw new RegistrationRequestError(
      'Too many verification attempts. Wait before trying again.',
      300,
    );
  if (error || !data.session || !data.user?.email_confirmed_at)
    throw Error(
      'This link is incorrect, expired or already used. Request a new verification email.',
    );
}
