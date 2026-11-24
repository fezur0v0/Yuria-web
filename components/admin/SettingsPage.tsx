'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createClient } from '@/utils/content/client';
import { uploadPublicMedia } from '@/utils/r2/client';
import { SITE_IMAGE_TYPES, MAX_SITE_IMAGE_BYTES } from '@/utils/r2/site-images';
import AdminLoading from './AdminLoading';
import styles from './basic-settings.module.css';

const content = createClient();
const acceptImages = SITE_IMAGE_TYPES.join(',');
const initialProfile = { nickname: '', bio: '', avatar_url: '' };

type Profile = typeof initialProfile;
type PictureKind = 'background' | 'avatar';
type Notice = { text: string; error?: boolean };
type ImageChoice = { file: File; preview: string };

function useImageChoice(kind: PictureKind) {
  const [choice, setChoice] = useState<ImageChoice>();
  const uploaded = useRef<{ file: File; url: string }>(null);

  useEffect(() => {
    if (!choice) return;
    return () => URL.revokeObjectURL(choice.preview);
  }, [choice]);

  function choose(file: File) {
    if (!SITE_IMAGE_TYPES.includes(file.type)) throw new Error('请选择 JPG、PNG、WebP、AVIF 或 GIF 图片。');
    if (file.size === 0 || file.size > MAX_SITE_IMAGE_BYTES) throw new Error('请选择不超过 20 MB 的有效图片。');
    uploaded.current = null;
    setChoice({ file, preview: URL.createObjectURL(file) });
  }

  async function upload() {
    if (!choice) return undefined;
    if (uploaded.current?.file === choice.file) return uploaded.current.url;
    const url = await uploadPublicMedia(choice.file, 'site/' + kind);
    // Reuse the completed upload if saving the setting needs to be retried.
    uploaded.current = { file: choice.file, url };
    return url;
  }

  function clear() {
    setChoice(undefined);
    uploaded.current = null;
  }

  return { preview: choice?.preview, choose, upload, clear };
}

function PicturePreview({ src, kind, alt }: { src: string; kind: PictureKind; alt: string }) {
  const [failedSrc, setFailedSrc] = useState('');
  return (
    <div className={kind === 'background' ? styles.photoFrame : styles.avatarFrame}>
      {src && src !== failedSrc ? (
        // Settings can still reference images from before the storage migration.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} onError={() => setFailedSrc(src)} />
      ) : <span className={styles.picturePlaceholder}>{src ? '预览不可用' : kind === 'background' ? '尚未设置背景' : '暂无头像'}</span>}
    </div>
  );
}

function PickImage({ label, onPick }: { label: string; onPick: (file: File) => void }) {
  return (
    <label className={styles.pictureButton}>
      <span>{label}</span>
      <input className="sr-only" type="file" accept={acceptImages} aria-label={label}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (file) onPick(file);
          event.currentTarget.value = '';
        }} />
    </label>
  );
}

function message(error: unknown, fallback: string): Notice {
  return { text: error instanceof Error ? error.message : fallback, error: true };
}

export default function AdminBasicPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cover, setCover] = useState('');
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [savedProfile, setSavedProfile] = useState<Profile>(initialProfile);
  const [savingCover, setSavingCover] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [coverNotice, setCoverNotice] = useState<Notice>();
  const [profileNotice, setProfileNotice] = useState<Notice>();
  const background = useImageChoice('background');
  const avatar = useImageChoice('avatar');
  const profileChanged = profile.nickname !== savedProfile.nickname || profile.bio !== savedProfile.bio || !!avatar.preview;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [backgroundResult, profileResult] = await Promise.all([
          content.from('site_config').select('value').eq('key', 'cover_url').limit(1),
          content.from('site_settings').select('nickname,bio,avatar_url').eq('id', true).limit(1),
        ]);
        if (backgroundResult.error || profileResult.error) throw new Error('Settings could not be loaded');
        if (cancelled) return;
        const row = profileResult.data?.[0];
        const currentProfile = {
          nickname: row?.nickname ?? '',
          bio: row?.bio ?? '',
          avatar_url: row?.avatar_url ?? '',
        };
        setCover(backgroundResult.data?.[0]?.value ?? '');
        setProfile(currentProfile);
        setSavedProfile(currentProfile);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  function chooseImage(file: File, field: 'background' | 'avatar') {
    const selection = field === 'background' ? background : avatar;
    const setNotice = field === 'background' ? setCoverNotice : setProfileNotice;
    try {
      selection.choose(file);
      setNotice(undefined);
    } catch (error) {
      setNotice(message(error, '无法选择这张图片。'));
    }
  }

  async function saveBackground(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!background.preview || savingCover) return;
    setSavingCover(true);
    setCoverNotice(undefined);
    try {
      const url = await background.upload();
      if (!url) throw new Error('未选择背景图片。');
      const { error } = await content.from('site_config').upsert({ key: 'cover_url', value: url }, { onConflict: 'key' });
      if (error) throw error;
      setCover(url);
      background.clear();
      setCoverNotice({ text: '背景已保存' });
    } catch (error) {
      setCoverNotice(message(error, '背景保存失败，请重试。'));
    } finally {
      setSavingCover(false);
    }
  }

  async function savePersonalDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileChanged || savingProfile) return;
    setSavingProfile(true);
    setProfileNotice(undefined);
    try {
      const avatarUrl = await avatar.upload();
      const patch: Partial<Profile> = {};
      if (profile.nickname !== savedProfile.nickname) patch.nickname = profile.nickname;
      if (profile.bio !== savedProfile.bio) patch.bio = profile.bio;
      if (avatarUrl) patch.avatar_url = avatarUrl;
      const { error } = await content.from('site_settings').upsert({ id: true, ...patch }, { onConflict: 'id' });
      if (error) throw error;
      const current = { ...profile, ...patch };
      setProfile(current);
      setSavedProfile(current);
      avatar.clear();
      setProfileNotice({ text: '资料已保存' });
    } catch (error) {
      setProfileNotice(message(error, '资料保存失败，请重试。'));
    } finally {
      setSavingProfile(false);
    }
  }

  if (loading) return <AdminLoading />;
  if (loadError) return <p role="alert" className={styles.loadError}>设置加载失败，请刷新后重试。</p>;

  return (
    <div className={styles.page}>
      <h1 className="sr-only">基本设置</h1>
      <form className={styles.background} aria-labelledby="basic-background-title" onSubmit={saveBackground}>
        <h2 id="basic-background-title">首页背景</h2>
        <fieldset disabled={savingCover} className={styles.controls}>
          <PicturePreview kind="background" src={background.preview ?? cover} alt="首页背景预览" />
          <div className={styles.actions}>
            <PickImage label={cover || background.preview ? '更换背景' : '选择背景'} onPick={file => chooseImage(file, 'background')} />
            <button className={styles.saveButton} type="submit" disabled={!background.preview}>
              {savingCover ? '正在保存…' : '保存背景'}
            </button>
            {background.preview && <button className={styles.cancel} type="button" onClick={() => {
              background.clear();
              setCoverNotice(undefined);
            }}>取消更换</button>}
          </div>
        </fieldset>
        <p className={styles.notice} role="status" data-error={!!coverNotice?.error}>{coverNotice?.text}</p>
      </form>

      <form className={styles.personal} aria-labelledby="basic-profile-title" onSubmit={savePersonalDetails}>
        <h2 id="basic-profile-title">个人资料</h2>
        <fieldset disabled={savingProfile} className={styles.controls}>
          <div className={styles.avatarRow}>
            <PicturePreview kind="avatar" src={avatar.preview ?? profile.avatar_url} alt="个人头像预览" />
            <div className={styles.avatarActions}>
              <PickImage label={profile.avatar_url || avatar.preview ? '更换头像' : '选择头像'} onPick={file => chooseImage(file, 'avatar')} />
              {avatar.preview && <button className={styles.cancel} type="button" onClick={() => {
                avatar.clear();
                setProfileNotice(undefined);
              }}>取消更换</button>}
            </div>
          </div>

          <label className={styles.field}>
            昵称
            <input value={profile.nickname} onChange={event => {
              const nickname = event.currentTarget.value;
              setProfile(previous => ({ ...previous, nickname }));
              setProfileNotice(undefined);
            }} />
          </label>
          <label className={styles.field}>
            个性签名
            <input value={profile.bio} onChange={event => {
              const bio = event.currentTarget.value;
              setProfile(previous => ({ ...previous, bio }));
              setProfileNotice(undefined);
            }} />
          </label>
          <div className={styles.actions}>
            <button className={styles.saveButton} type="submit" disabled={!profileChanged}>
              {savingProfile ? '正在保存…' : '保存资料'}
            </button>
          </div>
        </fieldset>
        <p className={styles.notice} role="status" data-error={!!profileNotice?.error}>{profileNotice?.text}</p>
      </form>
    </div>
  );
}
