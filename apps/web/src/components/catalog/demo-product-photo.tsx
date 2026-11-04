'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import styles from './catalog.module.css';

type Photo = {
  src: string;
  alt: string;
  width: number;
  height: number;
  role: string;
};
export function DemoProductPhoto({
  images,
  gallery = false,
  compact = false,
  fallback,
}: {
  images: Photo[];
  gallery?: boolean;
  compact?: boolean;
  fallback: ReactNode;
}) {
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const visible = images.filter((image) => !failed.includes(image.src));
  const image = visible[selected] ?? visible[0];
  if (!image) return fallback;
  return (
    <div className={styles.demoPhotoGroup}>
      <div
        className={`${styles.demoPhoto} ${compact ? styles.demoPhotoCompact : ''}`}
      >
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          unoptimized
          sizes={compact ? '85px' : '(max-width: 760px) 100vw, 40vw'}
          onError={() => {
            setFailed((old) => [...old, image.src]);
            setSelected(0);
          }}
        />
      </div>
      {gallery && visible.length > 1 ? (
        <div
          className={styles.demoPhotoSwitch}
          role="group"
          aria-label="Изображения товара"
        >
          {visible.map((photo, index) => (
            <button
              key={photo.src}
              type="button"
              aria-pressed={image.src === photo.src}
              onClick={() => setSelected(index)}
            >
              {photo.role === 'primary' ? 'Основной вид' : 'Несколько ракурсов'}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
