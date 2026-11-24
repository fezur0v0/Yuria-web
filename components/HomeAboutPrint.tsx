'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import { FiArrowUpRight } from 'react-icons/fi';

export default function HomeAboutPrint({ src }: { src: string }) {
  const fineMotion = useRef<MediaQueryList>(null);
  const paper = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);

  function move(event: PointerEvent<HTMLAnchorElement>) {
    if (event.pointerType !== 'mouse' || !fineMotion.current?.matches) return;
    const element = paper.current;
    if (!element) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!fineMotion.current?.matches) return;
      element.style.setProperty('--print-x', (-y * 4).toFixed(2) + 'deg');
      element.style.setProperty('--print-y', (x * 5).toFixed(2) + 'deg');
      element.dataset.tilting = 'true';
    });
  }

  const reset = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const element = paper.current;
    element?.style.removeProperty('--print-x');
    element?.style.removeProperty('--print-y');
    element?.removeAttribute('data-tilting');
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    fineMotion.current = media;
    media.addEventListener('change', reset);
    return () => {
      media.removeEventListener('change', reset);
      fineMotion.current = null;
      reset();
    };
  }, [reset]);

  return (
    <Link href="/me" className="home-hero__print" onPointerMove={move}
      onPointerLeave={reset} onPointerCancel={reset} onBlur={reset}>
      <div className="home-hero__paper" ref={paper}>
        <div className="home-hero__print-image">
          {/* Existing covers and custom uploads can use external image URLs. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt="" draggable={false} />}
        </div>
        <div className="home-hero__print-caption">
          <strong>关于我</strong>
          <FiArrowUpRight size={16} aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
