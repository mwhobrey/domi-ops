import nodemailer from "nodemailer";
import type { Env } from "@domi-ops/config";
import { isSmtpConfigured } from "@domi-ops/config";

export async function sendVerificationEmail(
  env: Env,
  input: { to: string; url: string; name?: string | null },
): Promise<void> {
  const subject = "Verify your Domi Ops account";
  const greeting = input.name?.trim() ? `Hi ${input.name.trim()},` : "Hi,";
  const text = `${greeting}\n\nVerify your email to finish setting up Domi Ops:\n\n${input.url}\n\nIf you did not sign up, you can ignore this message.`;
  const html = `<p>${greeting}</p><p>Verify your email to finish setting up Domi Ops:</p><p><a href="${input.url}">${input.url}</a></p><p>If you did not sign up, you can ignore this message.</p>`;

  if (!isSmtpConfigured(env)) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured — cannot send verification email");
    }
    console.warn(`[domi-ops auth] SMTP not configured — verification link for ${input.to}:\n${input.url}`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });

  await transport.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(
  env: Env,
  input: { to: string; url: string; name?: string | null },
): Promise<void> {
  const subject = "Reset your Domi Ops password";
  const greeting = input.name?.trim() ? `Hi ${input.name.trim()},` : "Hi,";
  const text = `${greeting}\n\nReset your Domi Ops password:\n\n${input.url}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this message — your password will not change.`;
  const html = `<p>${greeting}</p><p>Reset your Domi Ops password:</p><p><a href="${input.url}">${input.url}</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this message — your password will not change.</p>`;

  if (!isSmtpConfigured(env)) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured — cannot send password reset email");
    }
    console.warn(`[domi-ops auth] SMTP not configured — password reset link for ${input.to}:\n${input.url}`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });

  await transport.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject,
    text,
    html,
  });
}
