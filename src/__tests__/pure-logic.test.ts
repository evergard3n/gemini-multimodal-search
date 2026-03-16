/**
 * Unit tests for pure logic functions — no API keys or infrastructure needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectFileType, chunkText } from '../ingest.js';
import { l2Normalize } from '../embed.js';
import { parseTranscript, parseTimestamp, formatTimestamp } from '../transcribe.js';

// ---------------------------------------------------------------------------
// detectFileType
// ---------------------------------------------------------------------------

describe('detectFileType', () => {
  it('detects image files by extension', () => {
    assert.equal(detectFileType('photo.png', 'application/octet-stream'), 'image');
    assert.equal(detectFileType('photo.jpg', 'application/octet-stream'), 'image');
    assert.equal(detectFileType('photo.jpeg', 'application/octet-stream'), 'image');
    assert.equal(detectFileType('photo.webp', 'application/octet-stream'), 'image');
    assert.equal(detectFileType('photo.gif', 'application/octet-stream'), 'image');
    assert.equal(detectFileType('photo.bmp', 'application/octet-stream'), 'image');
  });

  it('detects image files by MIME type', () => {
    assert.equal(detectFileType('unknown', 'image/png'), 'image');
    assert.equal(detectFileType('unknown', 'image/jpeg'), 'image');
  });

  it('detects audio files by extension', () => {
    assert.equal(detectFileType('song.mp3', 'application/octet-stream'), 'audio');
    assert.equal(detectFileType('song.wav', 'application/octet-stream'), 'audio');
    assert.equal(detectFileType('song.flac', 'application/octet-stream'), 'audio');
    assert.equal(detectFileType('song.ogg', 'application/octet-stream'), 'audio');
    assert.equal(detectFileType('song.m4a', 'application/octet-stream'), 'audio');
  });

  it('detects audio files by MIME type', () => {
    assert.equal(detectFileType('unknown', 'audio/mpeg'), 'audio');
  });

  it('detects video files by extension', () => {
    assert.equal(detectFileType('clip.mp4', 'application/octet-stream'), 'video');
    assert.equal(detectFileType('clip.mov', 'application/octet-stream'), 'video');
    assert.equal(detectFileType('clip.webm', 'application/octet-stream'), 'video');
    assert.equal(detectFileType('clip.avi', 'application/octet-stream'), 'video');
  });

  it('detects video files by MIME type', () => {
    assert.equal(detectFileType('unknown', 'video/mp4'), 'video');
  });

  it('detects text files by extension', () => {
    assert.equal(detectFileType('doc.txt', 'application/octet-stream'), 'text');
    assert.equal(detectFileType('doc.md', 'application/octet-stream'), 'text');
    assert.equal(detectFileType('doc.html', 'application/octet-stream'), 'text');
    assert.equal(detectFileType('doc.csv', 'application/octet-stream'), 'text');
    assert.equal(detectFileType('doc.json', 'application/octet-stream'), 'text');
  });

  it('detects text files by MIME type', () => {
    assert.equal(detectFileType('unknown', 'text/plain'), 'text');
    assert.equal(detectFileType('unknown', 'text/html'), 'text');
  });

  it('detects PDF as text', () => {
    assert.equal(detectFileType('doc.pdf', 'application/octet-stream'), 'text');
    assert.equal(detectFileType('unknown', 'application/pdf'), 'text');
  });

  it('returns unsupported for unknown types', () => {
    assert.equal(detectFileType('file.xyz', 'application/octet-stream'), 'unsupported');
    assert.equal(detectFileType('file.bin', 'application/octet-stream'), 'unsupported');
  });
});

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('Hello world', 1000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], 'Hello world');
  });

  it('splits on paragraph boundaries', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const chunks = chunkText(text, 20);
    assert.ok(chunks.length >= 2, `Expected >=2 chunks, got ${chunks.length}`);
    assert.ok(chunks[0].includes('Paragraph one'));
  });

  it('keeps paragraphs together when under target size', () => {
    const text = 'Short one.\n\nShort two.';
    const chunks = chunkText(text, 1000);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].includes('Short one.'));
    assert.ok(chunks[0].includes('Short two.'));
  });

  it('returns the original text for empty-ish input', () => {
    const chunks = chunkText('', 1000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], '');
  });

  it('handles text with no paragraph breaks', () => {
    const text = 'A'.repeat(3000);
    const chunks = chunkText(text, 1000);
    // Can't split on paragraphs, so it stays as one chunk
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 3000);
  });
});

// ---------------------------------------------------------------------------
// l2Normalize
// ---------------------------------------------------------------------------

describe('l2Normalize', () => {
  it('normalizes a vector to unit length', () => {
    const result = l2Normalize([3, 4]);
    const magnitude = Math.sqrt(result[0] ** 2 + result[1] ** 2);
    assert.ok(Math.abs(magnitude - 1.0) < 1e-10, `Expected magnitude ~1, got ${magnitude}`);
    assert.ok(Math.abs(result[0] - 0.6) < 1e-10);
    assert.ok(Math.abs(result[1] - 0.8) < 1e-10);
  });

  it('handles zero vector without error', () => {
    const result = l2Normalize([0, 0, 0]);
    assert.deepEqual(result, [0, 0, 0]);
  });

  it('handles already-normalized vector', () => {
    const result = l2Normalize([1, 0, 0]);
    assert.ok(Math.abs(result[0] - 1.0) < 1e-10);
    assert.ok(Math.abs(result[1]) < 1e-10);
  });

  it('normalizes high-dimensional vector', () => {
    const vec = Array.from({ length: 1536 }, (_, i) => i * 0.01);
    const result = l2Normalize(vec);
    const magnitude = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(magnitude - 1.0) < 1e-10, `Expected magnitude ~1, got ${magnitude}`);
  });
});

// ---------------------------------------------------------------------------
// parseTimestamp / formatTimestamp
// ---------------------------------------------------------------------------

describe('parseTimestamp', () => {
  it('parses MM:SS format', () => {
    assert.equal(parseTimestamp('0:00'), 0);
    assert.equal(parseTimestamp('1:30'), 90);
    assert.equal(parseTimestamp('10:05'), 605);
  });

  it('parses H:MM:SS format', () => {
    assert.equal(parseTimestamp('1:00:00'), 3600);
    assert.equal(parseTimestamp('1:02:34'), 3754);
    assert.equal(parseTimestamp('2:30:00'), 9000);
  });
});

describe('formatTimestamp', () => {
  it('formats seconds to M:SS', () => {
    assert.equal(formatTimestamp(0), '0:00');
    assert.equal(formatTimestamp(90), '1:30');
    assert.equal(formatTimestamp(605), '10:05');
  });

  it('handles fractional seconds by flooring', () => {
    assert.equal(formatTimestamp(90.7), '1:30');
  });
});

// ---------------------------------------------------------------------------
// parseTranscript
// ---------------------------------------------------------------------------

describe('parseTranscript', () => {
  it('parses timestamped transcript with speakers', () => {
    const raw = `[0:00] Speaker 1: Hello and welcome to the show.
[0:15] Speaker 2: Thanks for having me.
[1:00] Speaker 1: Let's talk about the topic.`;

    const result = parseTranscript(raw);

    assert.equal(result.segments.length, 3);
    assert.equal(result.segments[0].startSeconds, 0);
    assert.equal(result.segments[0].endSeconds, 15);
    assert.equal(result.segments[0].speaker, 1);
    assert.ok(result.segments[0].text.includes('Hello and welcome'));

    assert.equal(result.segments[1].startSeconds, 15);
    assert.equal(result.segments[1].speaker, 2);

    assert.ok(result.durationSeconds > 0);
  });

  it('parses timestamps without speakers', () => {
    const raw = `[0:00] Introduction to the topic.
[2:30] Moving on to the next section.`;

    const result = parseTranscript(raw);

    assert.equal(result.segments.length, 2);
    assert.equal(result.segments[0].speaker, undefined);
    assert.equal(result.segments[0].startSeconds, 0);
    assert.equal(result.segments[1].startSeconds, 150);
  });

  it('handles multi-line segments', () => {
    const raw = `[0:00] Speaker 1: This is the first line.
And this continues on the next line.
Still going.
[1:00] Speaker 1: New segment.`;

    const result = parseTranscript(raw);

    assert.equal(result.segments.length, 2);
    assert.ok(result.segments[0].text.includes('first line'));
    assert.ok(result.segments[0].text.includes('continues'));
    assert.ok(result.segments[0].text.includes('Still going'));
  });

  it('falls back to single segment for plain text', () => {
    const raw = 'Just some plain text without any timestamps.';
    const result = parseTranscript(raw);

    assert.equal(result.segments.length, 1);
    assert.equal(result.segments[0].text, raw);
    assert.equal(result.segments[0].startSeconds, 0);
  });

  it('handles empty input', () => {
    const result = parseTranscript('');
    assert.equal(result.segments.length, 0);
    assert.equal(result.fullText, '');
  });

  it('produces formatted text with timestamps', () => {
    const raw = `[0:00] Speaker 1: Hello.
[0:30] Speaker 2: Hi.`;

    const result = parseTranscript(raw);
    assert.ok(result.formattedText.includes('[0:00]'));
    assert.ok(result.formattedText.includes('Speaker 1'));
    assert.ok(result.formattedText.includes('[0:30]'));
  });
});
