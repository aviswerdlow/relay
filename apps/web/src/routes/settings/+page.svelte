<script lang="ts">
  import type { PageData } from './$types';

  export let data: PageData;

  let timeWindowDays = data.settings.timeWindowDays;
  let retentionDays = data.settings.retentionDays;
  let status: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  let message = '';

  async function save() {
    status = 'saving';
    message = '';

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeWindowDays, retentionDays })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to update settings');
      }

      const body = await res.json();
      timeWindowDays = body.settings.timeWindowDays;
      retentionDays = body.settings.retentionDays;
      status = 'saved';
      message = 'Settings updated.';
    } catch (err) {
      status = 'error';
      message = err instanceof Error ? err.message : 'Unable to update settings';
    }
  }
</script>

<section class="settings">
  <header>
    <h1>Settings</h1>
    <p>Adjust scan defaults and data retention limits.</p>
  </header>

  <form on:submit|preventDefault={save}>
    <label>
      Scan window (days)
      <input type="number" bind:value={timeWindowDays} min="7" max="365" />
    </label>

    <label>
      Retention (days)
      <input type="number" bind:value={retentionDays} min="7" max="365" />
    </label>

    <button type="submit" disabled={status === 'saving'}>
      {status === 'saving' ? 'Saving…' : 'Save changes'}
    </button>
  </form>

  {#if message}
    <p class:success={status === 'saved'} class:error={status === 'error'}>{message}</p>
  {/if}
</section>

<style>
  .settings {
    padding: 3rem 1.5rem;
    max-width: 640px;
    margin: 0 auto;
    color: #f8fafc;
  }

  header h1 {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  header p {
    margin: 0 0 1.5rem;
    color: rgba(248, 250, 252, 0.7);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-weight: 600;
  }

  input {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(15, 23, 42, 0.6);
    color: #f8fafc;
  }

  button {
    align-self: flex-start;
    padding: 0.6rem 1.5rem;
    border-radius: 999px;
    border: none;
    background: #2563eb;
    color: white;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .success {
    color: #86efac;
  }

  .error {
    color: #f87171;
  }
</style>
