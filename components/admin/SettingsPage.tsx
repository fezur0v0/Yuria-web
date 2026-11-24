'use client';

import { useEffect, useRef, useState } from 'react';
import { FiImage, FiRefreshCw } from 'react-icons/fi';
import { createClient } from '@/utils/content/client';
import { HOME_POLAROID_KEY, homePolaroidImage } from '@/utils/content/home-polaroid';
import { uploadPublicMedia } from '@/utils/r2/client';
import { SITE_IMAGE_TYPES, MAX_SITE_IMAGE_BYTES } from '@/utils/r2/site-images';
import AdminLoading from './AdminLoading';
import styles from './basic-settings.module.css';

const content = createClient();
const acceptImages = SITE_IMAGE_TYPES.join(',');
const emptyProfile = { nickname: '', bio: '' };

type TextField = keyof typeof emptyProfile;
type PictureKind = 'background' | 'avatar' | 'polaroid';
type Notice = { text: string; error?: boolean };
const pictureNames: Record<PictureKind, string> = {
  background: '背景',
  avatar: '头像',
  polaroid: '拍立得照片',
};

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function saveSiteImage(key: string, url: string) {
  const { error } = await content.from('site_config').upsert({ key, value: url }, { onConflict: 'key' });
  if (error) throw error;
}

async function saveProfile(patch: Partial<typeof emptyProfile & { avatar_url: string }>) {
  const { error } = await content.from('site_settings').upsert({ id: true, ...patch }, { onConflict: 'id' });
  if (error) throw error;
}

function EditablePicture({ kind, src, onSave }: {
  kind: PictureKind;
  src: string;
  onSave: (url: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [failedSrc, setFailedSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [retry, setRetry] = useState<{ file: File; url?: string }>();
  const locked = useRef(false);
  const name = pictureNames[kind];
  const currentSrc = draft || src;
  const pickerLabel = (src ? '更换' : '选择') + name;

  useEffect(() => {
    if (draft) return () => URL.revokeObjectURL(draft);
  }, [draft]);

  useEffect(() => {
    if (!notice || notice.error) return;
    const timeout = window.setTimeout(() => setNotice(undefined), 2400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function replace(file: File, uploadedUrl?: string) {
    if (locked.current) return;
    setRetry(undefined);
    if (!SITE_IMAGE_TYPES.includes(file.type) || file.size <= 0 || file.size > MAX_SITE_IMAGE_BYTES) {
      setNotice({ text: '请选择 20 MB 以内的 JPG、PNG、WebP、AVIF 或 GIF 图片。', error: true });
      return;
    }

    locked.current = true;
    setBusy(true);
    const preview = URL.createObjectURL(file);
    setDraft(preview);
    setNotice({ text: '正在保存' + name + '…' });
    let url = uploadedUrl;
    try {
      // Reject corrupt images before making them public.
      const image = new window.Image();
      image.src = preview;
      try { await image.decode(); } catch { throw new Error('无法读取这张图片，请重新选择。'); }
      url ??= await uploadPublicMedia(file, 'site/' + kind);
      await onSave(url);
      setNotice({ text: name + '已保存' });
    } catch (error) {
      setNotice({ text: message(error, name + '保存失败。'), error: true });
      if (url) setRetry({ file, url });
    } finally {
      setDraft('');
      setBusy(false);
      locked.current = false;
    }
  }

  const PickerIcon = kind === 'polaroid' ? FiRefreshCw : FiImage;
  const picker = (
    <label className={styles.pictureButton} title={pickerLabel} data-busy={busy}>
      <PickerIcon size={18} aria-hidden="true" />
      <input type="file" className="sr-only" aria-label={pickerLabel} accept={acceptImages} disabled={busy}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void replace(file);
        }} />
    </label>
  );

  return (
    <div className={styles.picture} data-kind={kind}>
      <div className={styles.pictureCard}>
        <div className={styles.imageWindow}>
          {currentSrc && failedSrc !== currentSrc ? (
            // Public images may come from existing external or R2 URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentSrc} alt={name + '预览'} onError={() => setFailedSrc(currentSrc)} />
          ) : <FiImage className={styles.placeholder} aria-hidden="true" />}
        </div>
        {kind === 'polaroid' ? (
          <div className={styles.paperCaption}>
            <span>关于我</span>
            {picker}
          </div>
        ) : picker}
      </div>
      <div className={styles.pictureNotice} data-error={!!notice?.error}>
        <span role="status">{notice?.text}</span>
        {retry && <button type="button" onClick={() => void replace(retry.file, retry.url)}>重试</button>}
      </div>
    </div>
  );
}

export default function AdminBasicPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [background, setBackground] = useState('');
  const [avatar, setAvatar] = useState('');
  const [polaroid, setPolaroid] = useState('');
  const [featured, setFeatured] = useState<{ work?: string; album?: string }>({});
  const [profile, setProfile] = useState(emptyProfile);
  const saved = useRef(emptyProfile);
  const pending = useRef<Partial<Record<TextField, { value: string }>>>({});
  const [textNotices, setTextNotices] = useState<Partial<Record<TextField, Notice>>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [configResult, profileResult, works, albums] = await Promise.all([
          content.from('site_config').select('key,value').in('key', ['cover_url', HOME_POLAROID_KEY]),
          content.from('site_settings').select('nickname,bio,avatar_url').eq('id', true).limit(1),
          content.from('portfolio_items').select('cover_url').eq('is_visible', true)
            .order('sort_order', { ascending: true, nullsFirst: false }).limit(1),
          content.from('gallery_albums').select('cover_image_url').eq('is_featured_home', true)
            .eq('is_visible', true).or('is_locked.is.null,is_locked.eq.false')
            .order('sort_order').limit(1),
        ]);
        if (configResult.error || profileResult.error) throw new Error('Settings could not be loaded');
        if (cancelled) return;
        const config = Object.fromEntries((configResult.data ?? []).map(row => [row.key, row.value]));
        const row = profileResult.data?.[0];
        const current = { nickname: row?.nickname ?? '', bio: row?.bio ?? '' };
        saved.current = current;
        setProfile(current);
        setAvatar(row?.avatar_url ?? '');
        setBackground(config.cover_url ?? '');
        setPolaroid(config[HOME_POLAROID_KEY] ?? '');
        setFeatured({ work: works.data?.[0]?.cover_url ?? undefined, album: albums.data?.[0]?.cover_image_url ?? undefined });
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  function setTextNotice(field: TextField, notice?: Notice) {
    setTextNotices(current => ({ ...current, [field]: notice }));
  }

  async function saveText(field: TextField, value: string) {
    if (value === (pending.current[field]?.value ?? saved.current[field])) return;
    const revision = { value };
    pending.current[field] = revision;
    setTextNotice(field, { text: '正在保存…' });
    try {
      await saveProfile({ [field]: value });
      saved.current = { ...saved.current, [field]: value };
      if (pending.current[field] === revision) setTextNotice(field, { text: '已保存' });
    } catch (error) {
      if (pending.current[field] === revision) setTextNotice(field, { text: message(error, '保存失败，重新聚焦后可再试。'), error: true });
    } finally {
      if (pending.current[field] === revision) delete pending.current[field];
    }
  }

  function profileInput(field: TextField, label: string) {
    return (
      <label className={styles.field} data-field={field}>
        <span className="sr-only">{label}</span>
        <input value={profile[field]} aria-label={label} placeholder={label}
          onChange={event => {
            const value = event.currentTarget.value;
            setProfile(current => ({ ...current, [field]: value }));
            setTextNotice(field);
          }}
          onBlur={event => void saveText(field, event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
          }} />
        <span className={styles.textNotice} role="status" data-error={!!textNotices[field]?.error}>
          {textNotices[field]?.text}
        </span>
      </label>
    );
  }

  if (loading) return <AdminLoading />;
  if (loadError) return <p role="alert">设置加载失败，请刷新后重试。</p>;

  return (
    <div className={styles.page}>
      <h1 className="sr-only">基本设置</h1>
      <section className={styles.identity} aria-label="背景和个人资料">
        <EditablePicture kind="background" src={background} onSave={async url => {
          await saveSiteImage('cover_url', url);
          setBackground(url);
        }} />
        <div className={styles.profile}>
          <EditablePicture kind="avatar" src={avatar} onSave={async url => {
            await saveProfile({ avatar_url: url });
            setAvatar(url);
          }} />
          <div className={styles.profileText}>
            {profileInput('nickname', '昵称')}
            {profileInput('bio', '个性签名')}
          </div>
        </div>
      </section>
      <section className={styles.polaroid} aria-label="首页拍立得">
        <EditablePicture kind="polaroid"
          src={homePolaroidImage(polaroid, featured.work, featured.album, background)} onSave={async url => {
            await saveSiteImage(HOME_POLAROID_KEY, url);
            setPolaroid(url);
          }} />
      </section>
    </div>
  );
}
