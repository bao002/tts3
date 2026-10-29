import { describe, expect, it } from 'vitest';
import { speechBody, speechLanguages } from '@/lib/fish-audio';
import { detectLanguageCode } from '@/lib/language-detection';

describe('Fish Audio multilingual requests', () => {
  it('keeps Hebrew text and language in the free model request', () => {
    const body = speechBody('שלום, מה שלומך?', 'he');
    expect(body).toMatchObject({ model: 'fish-audio/s2.1-pro-free:free', input: 'שלום, מה שלומך?', language: 'he' });
  });
  it('uses the translated language rather than an options override', () => {
    expect(speechBody('Bonjour', 'fr', undefined, 1, { language: 'en' })).toMatchObject({ input: 'Bonjour', language: 'fr' });
  });
  it('selects a licensed voice for the requested language and preserves explicit voices', () => {
    expect(speechBody('Bonjour', 'fr-FR').voice).toBe('fce1bed339724d91b5c9c4d01bb6e796');
    expect(speechBody('Ciao', 'it', 'custom-voice').voice).toBe('custom-voice');
  });
  it('does not use the English reference voice for non-English languages', () => {
    expect(speechBody('שלום', 'he').voice).toBeUndefined();
    expect(speechBody('Hello', 'en').voice).toBe('b347db033a6549378b48d00acb0d06cd');
  });
  it('offers YouTube caption codes and passes regional language tags through', () => {
    expect(speechLanguages).toContainEqual(['zh-Hant', 'Chinese (Traditional)']);
    expect(speechLanguages).toContainEqual(['es-419', 'Spanish (Latin America)']);
    expect(speechBody('Xin chao', 'vi').language).toBe('vi');
  });
  it('detects common languages locally and waits for enough text', () => {
    expect(detectLanguageCode('Bonjour, comment allez-vous aujourd’hui ? La lumière du soir est magnifique.')).toBe('fr');
    expect(detectLanguageCode('Ciao, come stai oggi? La luce della sera è bellissima.')).toBe('it');
    expect(detectLanguageCode('שלום, מה שלומך היום?')).toBe('he');
    expect(detectLanguageCode('你好，今天过得怎么样？')).toBe('zh');
    expect(detectLanguageCode('مرحباً، كيف حالك اليوم؟ أحب أن أتعلم لغات جديدة.')).toBe('ar');
    expect(detectLanguageCode('سلام، من امروز می‌خواهم درباره زبان‌های جدید یاد بگیرم.')).toBe('fa');
    expect(detectLanguageCode('Hello')).toBeUndefined();
  });
});