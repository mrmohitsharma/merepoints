import { Injectable, Logger } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import { config } from '../config';

export type PushMessage = { token: string; title: string; body: string; imageUrl?: string | null; data: Record<string, string> };
export type PushResult = { token: string; ok: boolean; invalid?: boolean };

/**
 * Sends phone push through Firebase Cloud Messaging (HTTP v1). With no FCM_SERVICE_ACCOUNT_JSON
 * it does nothing, and notifications still reach the in-app inbox.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('push');
  private auth?: GoogleAuth;
  private projectId = '';

  get enabled() { return !!config.fcm.serviceAccountJson; }

  private client() {
    if (!this.auth) {
      const cred = JSON.parse(config.fcm.serviceAccountJson);
      this.projectId = cred.project_id;
      this.auth = new GoogleAuth({ credentials: cred, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
    }
    return this.auth;
  }

  async send(msgs: PushMessage[]): Promise<PushResult[]> {
    if (!this.enabled || !msgs.length) return msgs.map((m) => ({ token: m.token, ok: false }));
    let headers: Record<string, string>;
    try {
      const c = await this.client().getClient();
      const t = await c.getAccessToken();
      headers = { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' };
    } catch (e: any) {
      this.log.error(`FCM auth failed: ${e?.message ?? e}`);
      return msgs.map((m) => ({ token: m.token, ok: false }));
    }
    const url = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
    const out: PushResult[] = [];
    for (let i = 0; i < msgs.length; i += 50) {
      const chunk = msgs.slice(i, i + 50);
      out.push(...(await Promise.all(chunk.map(async (m): Promise<PushResult> => {
        try {
          const res = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify({ message: {
              token: m.token,
              notification: { title: m.title, body: m.body, ...(m.imageUrl ? { image: m.imageUrl } : {}) },
              data: m.data,
              android: { priority: 'HIGH' },
            } }),
          });
          if (res.ok) return { token: m.token, ok: true };
          const txt = await res.text();
          return { token: m.token, ok: false, invalid: res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt) };
        } catch { return { token: m.token, ok: false }; }
      }))));
    }
    return out;
  }
}
