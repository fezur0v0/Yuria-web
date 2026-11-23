'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  closestCenter, DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useReducedMotion } from '@/components/gallery/useReducedMotion';
import styles from './gallery-admin.module.css';

export type Album = {
  id: string;
  title: string;
  cover_image_url: string | null;
  sort_order: number;
  is_visible: boolean;
  is_featured_home: boolean;
};

export function AlbumCover({ url }: { url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!url || url === failedUrl) return <span className={styles.coverPlaceholder} aria-hidden="true" />;

  // Album covers can be hosted outside next/image's site asset allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={styles.coverImage} draggable={false} onError={() => setFailedUrl(url)} />;
}

function AlbumSummary({ album }: { album: Album }) {
  return <>
    <span className={styles.thumbnail}><AlbumCover url={album.cover_image_url} /></span>
    <span className={styles.albumTitle}>{album.title}</span>
    <span className={styles.albumStatus} data-hidden={!album.is_visible}>{album.is_visible ? '已公开' : '已隐藏'}</span>
  </>;
}

function AlbumRow({ album, selected, busy, sortable, marker, reducedMotion, onSelect }: {
  album: Album;
  selected: boolean;
  busy: boolean;
  sortable: boolean;
  marker?: 'before' | 'after';
  reducedMotion: boolean;
  onSelect: () => void;
}) {
  const { listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: album.id,
    disabled: busy || !sortable,
    transition: reducedMotion ? null : { duration: 235, easing: 'cubic-bezier(.22,.61,.36,1)' },
  });
  return (
    <li ref={setNodeRef} className={styles.listItem} data-insertion={marker}
      style={{ transform: CSS.Translate.toString(transform), transition: reducedMotion ? undefined : transition }}>
      <div className={styles.albumRow} data-selected={selected} data-drag-source={isDragging}>
        <button {...listeners} ref={setActivatorNodeRef} type="button" className={styles.albumSelect}
          data-sortable={sortable} disabled={busy} aria-pressed={selected}
          aria-label={'编辑相册 ' + album.title} onContextMenu={sortable ? event => event.preventDefault() : undefined}
          onClick={onSelect}>
          <AlbumSummary album={album} />
        </button>
        <Link href={'/gallery/' + album.id} className={styles.manageLink} aria-label={'管理照片：' + album.title}>
          管理照片
        </Link>
      </div>
    </li>
  );
}

export default function GalleryAlbumList({ albums, selectedId, busy, onSelect, onReorder }: {
  albums: Album[];
  selectedId?: string;
  busy: boolean;
  onSelect: (album: Album) => void;
  onReorder: (albums: Album[]) => void;
}) {
  const sortable = albums.length > 1;
  const reducedMotion = useReducedMotion();
  // Separate touch and mouse sensors let a normal swipe keep scrolling until a hold activates.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 320, tolerance: 9 } }),
  );
  const [activeId, setActiveId] = useState<string>();
  const [overId, setOverId] = useState<string>();
  const activeIndex = albums.findIndex(album => album.id === activeId);
  const overIndex = albums.findIndex(album => album.id === overId);
  const active = albums[activeIndex];

  function clearDrag() {
    setActiveId(undefined);
    setOverId(undefined);
  }

  function finishDrag({ active, over }: DragEndEvent) {
    clearDrag();
    if (busy || !over || active.id === over.id) return;
    const from = albums.findIndex(album => album.id === active.id);
    const to = albums.findIndex(album => album.id === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(albums, from, to));
  }

  function updateTarget({ over }: DragOverEvent) {
    setOverId(over ? String(over.id) : undefined);
  }

  if (!albums.length) return <p className={styles.empty}>还没有相册，可以先新建一本。</p>;
  return (
    <DndContext id="admin-gallery-sort" sensors={sensors} collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(String(active.id))} onDragOver={updateTarget}
      onDragCancel={clearDrag} onDragEnd={finishDrag}
      accessibility={{
        announcements: {
          onDragStart: () => '已拖起相册。',
          onDragOver: ({ over }) => over ? '目标排序位置已更新。' : undefined,
          onDragEnd: () => '已放下相册。',
          onDragCancel: () => '已取消排序。',
        },
      }}>
      <SortableContext items={albums.map(album => album.id)} strategy={verticalListSortingStrategy}>
        <ul className={styles.albumList}>
          {albums.map((album, index) => (
            <AlbumRow key={album.id} album={album} selected={selectedId === album.id}
              busy={busy} sortable={sortable} reducedMotion={reducedMotion}
              marker={activeIndex >= 0 && index === overIndex && index !== activeIndex
                ? (index < activeIndex ? 'before' : 'after') : undefined}
              onSelect={() => onSelect(album)} />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay dropAnimation={reducedMotion ? null : { duration: 240, easing: 'cubic-bezier(.22,.61,.36,1)' }}>
        {active && (
          <div aria-hidden="true" className={styles.liftedRow}>
            <div className={styles.albumSelect}><AlbumSummary album={active} /></div>
            <span className={styles.manageLink}>管理照片</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
