'use client';

import {
  type OwnReview,
  REVIEW_HIDE_REASON_LABELS,
  REVIEW_PHOTO_MAX_COUNT,
  REVIEW_TEXT_MAX_LENGTH,
} from '@greenhub/shared';
import { Box, Button, Group, Paper, Stack, Text, Textarea } from '@mantine/core';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { HideOnErrorImage } from '@/components/ResilientImage';
import {
  BenchmarkApiError,
  createReview,
  deleteReview,
  fetchOrderReviews,
  uploadReviewPhotos,
} from '@/lib/benchmark-api';
import { hiddenReviewNotice } from '@/lib/benchmark-format';
import { canAddReviewPhotos, selectReviewPhotos } from '@/lib/review-photo';
import { encodeReviewPhoto, ReviewPhotoEncodeError } from '@/lib/review-photo-encode';
import { ReviewPhotoStrip } from './ReviewPhotos';

// MY 주문 상세의 후기: 쓰기(별점·글·사진 3장까지), 쓴 후기에 사진 더하기, 내 후기 지우기.
// 쓰기는 로그인한 본인의 배송 완료 주문에서만 열린다(서버도 같은 조건을 다시 확인한다).

function errorText(cause: unknown, fallback: string): string {
  if (cause instanceof BenchmarkApiError || cause instanceof ReviewPhotoEncodeError)
    return cause.message;
  return fallback;
}

async function encodeAll(files: File[]): Promise<Blob[]> {
  // 휴대폰 메모리를 아끼려고 한 장씩 줄인다.
  const blobs: Blob[] = [];
  for (const file of files) blobs.push(await encodeReviewPhoto(file));
  return blobs;
}

/** 사진 고르기 버튼과 고른 사진 미리보기. */
function PhotoPicker({
  files,
  existingCount,
  disabled,
  onChange,
  onMessage,
}: {
  files: File[];
  existingCount: number;
  disabled?: boolean;
  onChange: (files: File[]) => void;
  onMessage: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const total = existingCount + files.length;

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    const { accepted, message } = selectReviewPhotos(total, picked, REVIEW_PHOTO_MAX_COUNT);
    onMessage(message);
    if (accepted.length > 0) onChange([...files, ...accepted]);
  };

  return (
    <Box>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={pick}
      />
      <Group gap={6} wrap="wrap">
        {previews.map((url, index) => (
          <Box key={url} style={{ position: 'relative' }}>
            <HideOnErrorImage
              src={url}
              alt={`고른 사진 ${index + 1}`}
              width={72}
              height={72}
              style={{
                borderRadius: 'var(--radius-sm)',
                height: 72,
                objectFit: 'cover',
                width: 72,
              }}
            />
            <Button
              size="compact-xs"
              variant="white"
              aria-label={`고른 사진 ${index + 1} 빼기`}
              onClick={() => onChange(files.filter((_, i) => i !== index))}
              style={{ position: 'absolute', right: 2, top: 2 }}
            >
              ✕
            </Button>
          </Box>
        ))}
        {total < REVIEW_PHOTO_MAX_COUNT && (
          <Button
            variant="default"
            radius="xl"
            size="compact-sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            사진 고르기 ({total}/{REVIEW_PHOTO_MAX_COUNT})
          </Button>
        )}
      </Group>
    </Box>
  );
}

function ReviewForm({
  orderId,
  productId,
  productName,
  token,
  onDone,
}: {
  orderId: string;
  productId: string;
  productName: string;
  token: string;
  onDone: (review: OwnReview, notice: string | null) => void;
}) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true);
    setError(null);
    let created: OwnReview;
    try {
      created = {
        ...(await createReview(orderId, token, { productId, rating, text: text.trim() })),
        hidden: false,
      };
    } catch (e) {
      setError(errorText(e, '후기를 남기지 못했어요.'));
      setSending(false);
      return;
    }
    if (photos.length === 0) {
      onDone(created, null);
      return;
    }
    try {
      onDone(await uploadReviewPhotos(created.id, token, await encodeAll(photos)), null);
    } catch (e) {
      // 글은 이미 남았다. 사진은 쓴 후기에서 다시 더할 수 있다.
      onDone(created, `후기는 남겼어요. 사진은 올리지 못했어요. ${errorText(e, '')}`.trim());
    }
  };

  return (
    <Stack gap={6} mt="xs">
      <Group gap={2} role="group" aria-label={`${productName} 별점`}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={rating === value}
            aria-label={`${value}점`}
            onClick={() => setRating(value)}
            style={{
              background: 'transparent',
              border: 0,
              color: value <= rating ? '#F5A524' : 'var(--color-border)',
              cursor: 'pointer',
              fontSize: 26,
              height: 'var(--touch-target)',
              padding: 0,
              width: 36,
            }}
          >
            ★
          </button>
        ))}
      </Group>
      <Textarea
        aria-label={`${productName} 후기`}
        placeholder="꽃 상태, 크기, 포장은 어땠나요?"
        maxLength={REVIEW_TEXT_MAX_LENGTH}
        autosize
        minRows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <PhotoPicker
        files={photos}
        existingCount={0}
        disabled={sending}
        onChange={setPhotos}
        onMessage={setError}
      />
      {error && (
        <Text role="alert" size="sm" c="var(--color-danger)">
          {error}
        </Text>
      )}
      <Button radius="xl" loading={sending} disabled={text.trim().length < 5} onClick={submit}>
        후기 남기기
      </Button>
    </Stack>
  );
}

/** 이미 쓴 후기: 숨김 안내, 사진, 사진 더하기, 지우기. */
function WrittenReview({
  review,
  productName,
  token,
  onChange,
  onDeleted,
}: {
  review: OwnReview;
  productName: string;
  token: string;
  onChange: (review: OwnReview) => void;
  onDeleted: () => void;
}) {
  const [adding, setAdding] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const existing = review.photoUrls?.length ?? 0;

  const upload = async () => {
    setBusy(true);
    setMessage(null);
    try {
      onChange(await uploadReviewPhotos(review.id, token, await encodeAll(adding)));
      setAdding([]);
    } catch (e) {
      setMessage(errorText(e, '사진을 올리지 못했어요.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${productName} 후기를 지울까요? 사진도 함께 지워져요.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteReview(review.id, token);
      onDeleted();
    } catch (e) {
      setMessage(errorText(e, '후기를 지우지 못했어요.'));
      setBusy(false);
    }
  };

  return (
    <Stack gap={6} mt={4}>
      {review.hidden && (
        <Text size="sm" c="var(--color-text-secondary)">
          {hiddenReviewNotice(
            review.hiddenReasonCode ? REVIEW_HIDE_REASON_LABELS[review.hiddenReasonCode] : null,
          )}
        </Text>
      )}
      <ReviewPhotoStrip urls={review.photoUrls} label={productName} />
      {canAddReviewPhotos(review, REVIEW_PHOTO_MAX_COUNT) && (
        <PhotoPicker
          files={adding}
          existingCount={existing}
          disabled={busy}
          onChange={setAdding}
          onMessage={setMessage}
        />
      )}
      <Group gap="xs">
        {adding.length > 0 && (
          <Button size="compact-sm" radius="xl" loading={busy} onClick={upload}>
            사진 {adding.length}장 올리기
          </Button>
        )}
        <Button
          size="compact-sm"
          radius="xl"
          variant="subtle"
          color="red"
          disabled={busy}
          onClick={remove}
        >
          후기 지우기
        </Button>
      </Group>
      {message && (
        <Text role="alert" size="sm" c="var(--color-danger)">
          {message}
        </Text>
      )}
    </Stack>
  );
}

export default function OrderReviews({
  orderId,
  token,
  items,
}: {
  orderId: string;
  token: string;
  items: Array<{ id: string; productId: string; productName: string }>;
}) {
  const [written, setWritten] = useState<Record<string, OwnReview>>({});
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetchOrderReviews(orderId, token)
      .then((list) => {
        if (active)
          setWritten(Object.fromEntries(list.map((review) => [review.productId, review])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orderId, token]);

  const save = (productId: string, review: OwnReview) =>
    setWritten((current) => ({ ...current, [productId]: review }));

  return (
    <Paper p="md" style={{ border: 'var(--border)', borderRadius: 'var(--radius)' }}>
      <Text fw={800} mb="xs">
        후기
      </Text>
      <Stack gap="sm">
        {items.map((item) => {
          const review = written[item.productId];
          return (
            <Box key={item.id}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={700}>
                  {item.productName}
                </Text>
                {review ? (
                  <Text size="sm" c="var(--color-primary-dark)" fw={700}>
                    ★ {review.rating} 남김
                  </Text>
                ) : (
                  <Button
                    size="compact-sm"
                    variant="light"
                    radius="xl"
                    onClick={() => setOpenForm(openForm === item.productId ? null : item.productId)}
                  >
                    후기 쓰기
                  </Button>
                )}
              </Group>
              {review && (
                <WrittenReview
                  review={review}
                  productName={item.productName}
                  token={token}
                  onChange={(next) => save(item.productId, next)}
                  onDeleted={() => {
                    setWritten(({ [item.productId]: _removed, ...rest }) => rest);
                    setNotice(({ [item.productId]: _old, ...rest }) => rest);
                  }}
                />
              )}
              {!review && openForm === item.productId && (
                <ReviewForm
                  orderId={orderId}
                  productId={item.productId}
                  productName={item.productName}
                  token={token}
                  onDone={(created, message) => {
                    save(item.productId, created);
                    setOpenForm(null);
                    if (message)
                      setNotice((current) => ({ ...current, [item.productId]: message }));
                  }}
                />
              )}
              {notice[item.productId] && (
                <Text role="status" size="sm" mt={4} c="var(--color-text-secondary)">
                  {notice[item.productId]}
                </Text>
              )}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
