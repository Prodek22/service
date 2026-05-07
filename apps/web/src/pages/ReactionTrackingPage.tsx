import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost } from '../api/client';
import { ReactionEventsResponse, ReactionTrackedMessagesResponse } from '../types';
import { formatDateTime } from '../utils/format';

const renderEmoji = (emojiName: string | null, emojiId: string | null): string => {
  if (emojiName && !emojiId) {
    return emojiName;
  }

  if (emojiName && emojiId) {
    return `:${emojiName}:`;
  }

  if (emojiId) {
    return `custom:${emojiId}`;
  }

  return '-';
};

const customEmojiUrl = (emojiId: string | null): string | null => {
  if (!emojiId) {
    return null;
  }

  return `https://cdn.discordapp.com/emojis/${emojiId}.png?size=48&quality=lossless`;
};

export const ReactionTrackingPage = () => {
  const [tracked, setTracked] = useState<ReactionTrackedMessagesResponse['items']>([]);
  const [eventsData, setEventsData] = useState<ReactionEventsResponse | null>(null);
  const [loadingTracked, setLoadingTracked] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newMessageId, setNewMessageId] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);

  const loadTracked = async () => {
    setLoadingTracked(true);
    try {
      const response = await apiGet<ReactionTrackedMessagesResponse>('/reactions/tracked-messages');
      setTracked(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca mesajele urmarite.');
    } finally {
      setLoadingTracked(false);
    }
  };

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (selectedMessageId.trim()) {
      params.set('messageId', selectedMessageId.trim());
    }

    return params.toString();
  }, [page, pageSize, selectedMessageId]);

  const loadEvents = async () => {
    setLoadingEvents(true);
    setError(null);

    try {
      const response = await apiGet<ReactionEventsResponse>(`/reactions/events?${query}`);
      setEventsData(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nu am putut incarca reacturile.');
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    void loadTracked();
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [query]);

  const addTrackedMessage = async (event: FormEvent) => {
    event.preventDefault();
    const messageId = newMessageId.trim();

    if (!/^\d{8,30}$/.test(messageId)) {
      setError('ID mesaj invalid.');
      return;
    }

    setError(null);

    try {
      const response = await apiPost<ReactionTrackedMessagesResponse>('/reactions/tracked-messages', { messageId });
      setTracked(response.items);
      setNewMessageId('');
      setSelectedMessageId(messageId);
      setPage(1);
      await loadEvents();
    } catch (saveError) {
      if (saveError instanceof ApiError) {
        setError(saveError.message);
        return;
      }

      setError(saveError instanceof Error ? saveError.message : 'Nu am putut salva mesajul.');
    }
  };

  const removeTrackedMessage = async (messageId: string) => {
    setError(null);

    try {
      const response = await apiDelete<ReactionTrackedMessagesResponse>(`/reactions/tracked-messages/${messageId}`);
      setTracked(response.items);
      if (selectedMessageId === messageId) {
        setSelectedMessageId('');
        setPage(1);
      }
      await loadEvents();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Nu am putut elimina mesajul.');
    }
  };

  return (
    <section>
      <h2>Reacturi mesaje urmarite</h2>

      <form className="card filters" onSubmit={addTrackedMessage}>
        <input
          placeholder="Message ID Discord (ex: 1390000000000000000)"
          value={newMessageId}
          onChange={(event) => setNewMessageId(event.target.value)}
        />
        <button type="submit" disabled={loadingTracked}>
          {loadingTracked ? 'Se salveaza...' : 'Adauga mesaj de urmarit'}
        </button>

        <select
          value={selectedMessageId}
          onChange={(event) => {
            setSelectedMessageId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Toate mesajele urmarite</option>
          {tracked.map((item) => (
            <option key={item.id} value={item.messageId}>
              {item.messageId}
            </option>
          ))}
        </select>

        <button type="button" onClick={() => void loadEvents()} disabled={loadingEvents}>
          {loadingEvents ? 'Refresh...' : 'Refresh'}
        </button>
      </form>

      <div className="card">
        <h3>Mesaje urmarite</h3>
        {!tracked.length ? <p>Nu ai inca mesaje configurate pentru tracking.</p> : null}
        <div className="table-actions">
          {tracked.map((item) => (
            <button key={item.id} type="button" className="btn-table-action secondary" onClick={() => void removeTrackedMessage(item.messageId)}>
              Sterge {item.messageId}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="card table-wrapper">
        <table className="timesheet-table">
          <thead>
            <tr>
              <th>Mesaj</th>
              <th>Utilizator</th>
              <th>React</th>
              <th>Actiune</th>
              <th>Data / ora</th>
            </tr>
          </thead>
          <tbody>
            {(eventsData?.items ?? []).map((item) => {
              const emojiUrl = customEmojiUrl(item.emojiId);

              return (
                <tr key={item.id}>
                  <td>
                    <a href={item.messageUrl} target="_blank" rel="noreferrer">
                      {item.messageId}
                    </a>
                  </td>
                  <td>
                    <strong>{item.userDisplayName}</strong>
                    <div className="muted-line">ID: {item.userId}</div>
                  </td>
                  <td>
                    <div className="reaction-emoji-cell">
                      {emojiUrl ? <img src={emojiUrl} alt={item.emojiName ?? 'emoji'} loading="lazy" /> : null}
                      <span>{renderEmoji(item.emojiName, item.emojiId)}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${item.action === 'ADD' ? 'ok' : 'danger'}`}>
                      {item.action === 'ADD' ? 'A adaugat' : 'A scos'}
                    </span>
                  </td>
                  <td>{formatDateTime(item.eventAt)}</td>
                </tr>
              );
            })}
            {!loadingEvents && !(eventsData?.items ?? []).length ? (
              <tr>
                <td colSpan={5}>Nu exista reacturi pentru filtrul selectat.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button
          className="btn-pagination"
          disabled={page <= 1 || loadingEvents}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Pagina anterioara
        </button>
        <span>
          Pagina {eventsData?.pagination.page ?? page} din {eventsData?.pagination.totalPages ?? 1}
        </span>
        <button
          className="btn-pagination"
          disabled={loadingEvents || !eventsData || page >= eventsData.pagination.totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Pagina urmatoare
        </button>
      </div>
    </section>
  );
};
