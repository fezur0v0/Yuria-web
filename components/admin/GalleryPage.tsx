'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { createClient } from '@/utils/content/client';
import AdminLoading from './AdminLoading';
import GalleryAlbumList, { AlbumCover, type Album } from './GalleryAlbumList';
import styles from './gallery-admin.module.css';

const content = createClient();

type AlbumDraft = Pick<Album, 'title' | 'cover_image_url' | 'is_visible' | 'is_featured_home'>;
type EditorSelection = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'initial' };
type Feedback = { text: string; error?: boolean };

function draftFor(album?: Album): AlbumDraft {
  return {
    title: album?.title ?? '',
    cover_image_url: album?.cover_image_url ?? null,
    is_visible: album?.is_visible ?? false,
    is_featured_home: album?.is_featured_home ?? false,
  };
}

export default function AdminGalleryPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selection, setSelection] = useState<EditorSelection>({ kind: 'initial' });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const locked = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const selectedAlbum = selection.kind === 'new' ? undefined
    : selection.kind === 'initial' ? albums[0] : albums.find(album => album.id === selection.id);
  const selectedIndex = albums.findIndex(album => album.id === selectedAlbum?.id);

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const { data, error } = await content.from('gallery_albums').select('*').order('sort_order');
        if (error) throw error;
        if (!disposed) setAlbums(data ?? []);
      } catch {
        if (!disposed) setLoadError(true);
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timeout = window.setTimeout(() => setFeedback(undefined), 2800);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  function showEditor(next: EditorSelection) {
    if (locked.current) return;
    setSelection(next);
    setFeedback(undefined);
    // The same form sits next to the list on desktop and below it on narrow screens.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => {
        panelRef.current?.focus({ preventScroll: true });
        panelRef.current?.scrollIntoView({ block: 'start' });
      });
    }
  }

  async function write<T>(operation: () => Promise<T>, errorMessage: string): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      return await operation();
    } catch {
      setFeedback({ text: errorMessage, error: true });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  async function saveAlbum(draft: AlbumDraft) {
    return write(async () => {
      if (!selectedAlbum) {
        const lastOrder = albums.reduce((max, album) => Math.max(max, album.sort_order ?? -1), -1);
        const { data, error } = await content.from('gallery_albums')
          .insert({ ...draft, sort_order: lastOrder + 1 }).select('*').single();
        if (error || !data) throw error ?? new Error('Album was not created');
        setAlbums(current => [...current, data]);
        setSelection({ kind: 'edit', id: data.id });
        setFeedback({ text: '相册已新建。' });
        return draftFor(data);
      }

      const original = draftFor(selectedAlbum);
      const patch: Partial<AlbumDraft> = {};
      if (draft.title !== original.title) patch.title = draft.title;
      if (draft.cover_image_url !== original.cover_image_url) patch.cover_image_url = draft.cover_image_url;
      if (draft.is_visible !== original.is_visible) patch.is_visible = draft.is_visible;
      if (draft.is_featured_home !== original.is_featured_home) patch.is_featured_home = draft.is_featured_home;
      if (!Object.keys(patch).length) return original;

      const { data, error } = await content.from('gallery_albums').update(patch)
        .eq('id', selectedAlbum.id).select('*').single();
      if (error || !data) throw error ?? new Error('Album was not updated');
      setAlbums(current => current.map(album => album.id === data.id ? data : album));
      setFeedback({ text: '相册设置已保存。' });
      return draftFor(data);
    }, '相册未能保存，请稍后重试。');
  }

  async function deleteAlbum(album: Album) {
    if (locked.current || !window.confirm('删除「' + album.title + '」及其中的全部照片记录？')) return;
    await write(async () => {
      const { error } = await content.from('gallery_albums').delete().eq('id', album.id);
      if (error) throw error;
      const next = albums.filter(item => item.id !== album.id);
      const neighbor = next[Math.min(selectedIndex, next.length - 1)];
      setAlbums(next);
      setSelection(neighbor ? { kind: 'edit', id: neighbor.id } : { kind: 'new' });
      setFeedback({ text: '相册已删除。' });
    }, '相册未能删除，请稍后重试。');
  }

  async function reorder(order: Album[]) {
    if (locked.current) return;
    const previous = albums;
    const next = order.map((album, index) => ({ ...album, sort_order: index }));
    const changed = next.filter((album, index) => order[index].sort_order !== index)
      .map(({ id, sort_order }) => ({ id, sort_order }));
    if (!changed.length) return;
    const selectedId = selectedAlbum?.id;

    await write(async () => {
      if (selection.kind === 'initial' && selectedId) setSelection({ kind: 'edit', id: selectedId });
      setAlbums(next);
      try {
        // One version-checked R2 write keeps the order consistent across all affected albums.
        const { error } = await content.from('gallery_albums').upsert(changed, { onConflict: 'id' });
        if (error) throw error;
        setFeedback({ text: '相册顺序已保存。' });
      } catch (error) {
        setAlbums(previous);
        throw error;
      }
    }, '顺序未能保存，已恢复原顺序。');
  }

  function moveSelected(direction: -1 | 1) {
    const target = selectedIndex + direction;
    if (selectedIndex >= 0 && target >= 0 && target < albums.length) {
      void reorder(arrayMove(albums, selectedIndex, target));
    }
  }

  if (loading) return <AdminLoading />;

  return (
    <section className={styles.page} aria-labelledby="admin-gallery-title">
      <header className={styles.header}>
        <div>
          <h1 id="admin-gallery-title">图册</h1>
          <p>相册管理</p>
        </div>
        <button type="button" className={styles.primaryButton} disabled={busy || loadError}
          onClick={() => showEditor({ kind: 'new' })}>
          <span aria-hidden="true">＋</span> 新建相册
        </button>
      </header>

      {loadError ? <p role="alert" className={styles.error}>相册加载失败，请刷新后重试。</p> : (
        <div className={styles.workspace}>
          <section className={styles.listPanel} aria-labelledby="album-list-title">
            <div className={styles.panelHeading}><h2 id="album-list-title">相册列表</h2></div>
            <GalleryAlbumList albums={albums} busy={busy} selectedId={selectedAlbum?.id}
              onSelect={album => showEditor({ kind: 'edit', id: album.id })} onReorder={reorder} />
          </section>
          <section className={styles.editorPanel} ref={panelRef} tabIndex={-1} aria-labelledby="album-editor-title">
            <AlbumEditor key={selectedAlbum?.id ?? 'new'} album={selectedAlbum} busy={busy}
              canMoveUp={selectedIndex > 0} canMoveDown={selectedIndex >= 0 && selectedIndex < albums.length - 1}
              onSave={saveAlbum} onDelete={deleteAlbum} onMove={moveSelected} />
          </section>
        </div>
      )}

      <div className={styles.feedback} role="status" aria-atomic="true" data-error={!!feedback?.error}>
        {feedback?.text}
      </div>
    </section>
  );
}

function AlbumEditor({ album, busy, canMoveUp, canMoveDown, onSave, onDelete, onMove }: {
  album?: Album;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (draft: AlbumDraft) => Promise<AlbumDraft | undefined>;
  onDelete: (album: Album) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState(() => draftFor(album));
  const [coverFieldOpen, setCoverFieldOpen] = useState(!album);
  const [validation, setValidation] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setValidation('请填写相册名。');
      titleRef.current?.focus();
      return;
    }
    setValidation('');
    const saved = await onSave({ ...draft, title, cover_image_url: draft.cover_image_url?.trim() || null });
    if (saved) {
      setDraft(saved);
      if (album) setCoverFieldOpen(false);
    }
  }

  function toggleCoverField() {
    setCoverFieldOpen(open => !open);
    if (!coverFieldOpen) requestAnimationFrame(() => coverRef.current?.focus());
  }

  return (
    <form className={styles.editor} onSubmit={submit}>
      <header className={styles.panelHeading}>
        <h2 id="album-editor-title">{album ? '编辑相册' : '新建相册'}</h2>
        {album && <p>{album.title}</p>}
      </header>
      <fieldset className={styles.editorFields} disabled={busy}>
        <label className={styles.field}>
          相册名
          <input ref={titleRef} value={draft.title} required
            onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))}
            autoComplete="off" />
        </label>
        {album && (
          <div className={styles.coverField}>
            <span className={styles.editorCover}><AlbumCover url={draft.cover_image_url} /></span>
            <button type="button" className={styles.textButton} aria-expanded={coverFieldOpen}
              onClick={toggleCoverField}>
              {coverFieldOpen ? '收起封面链接' : '更换封面'}
            </button>
          </div>
        )}
        {coverFieldOpen && <label className={styles.field}>
          封面图 URL
          <input ref={coverRef} value={draft.cover_image_url ?? ''} inputMode="url"
            onChange={event => setDraft(prev => ({ ...prev, cover_image_url: event.target.value }))}
            placeholder="可留空" autoComplete="off" />
        </label>}
        {album && <div className={styles.toggleGroup}>
          <label className={styles.switchLabel}>
            公开显示
            <input type="checkbox" role="switch" checked={draft.is_visible}
              onChange={event => setDraft(prev => ({ ...prev, is_visible: event.target.checked }))} />
            <span className={styles.switchTrack} aria-hidden="true" />
          </label>
          <label className={styles.switchLabel}>
            首页精选
            <input type="checkbox" role="switch" checked={draft.is_featured_home}
              onChange={event => setDraft(prev => ({ ...prev, is_featured_home: event.target.checked }))} />
            <span className={styles.switchTrack} aria-hidden="true" />
          </label>
        </div>}
        {validation && <p className={styles.error} role="alert">{validation}</p>}
        <button type="submit" className={styles.primaryButton}>
          {busy ? '处理中…' : album ? '保存修改' : '新建相册'}
        </button>
        {album && <div className={styles.secondaryActions}>
          {(canMoveUp || canMoveDown) && (
            <details className={styles.moveMenu}>
              <summary>调整顺序</summary>
              <div>
                <button type="button" className={styles.textButton} disabled={!canMoveUp} onClick={() => onMove(-1)}>上移</button>
                <button type="button" className={styles.textButton} disabled={!canMoveDown} onClick={() => onMove(1)}>下移</button>
              </div>
            </details>
          )}
          <button type="button" className={styles.deleteButton} onClick={() => onDelete(album)}>删除相册</button>
        </div>}
      </fieldset>
    </form>
  );
}
