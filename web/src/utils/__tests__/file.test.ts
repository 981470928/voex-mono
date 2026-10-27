import { describe, it, expect } from 'vitest';
import {
  getFileExtension,
  hasFileExtension,
  getExtensionByMimeType,
  ensureFileExtension,
  getFileNameFromPath,
  generateUniqueFilename,
} from './file';

describe('File Utils', () => {
  describe('getFileExtension', () => {
    it('should return extension with dot', () => {
      expect(getFileExtension('document.txt')).toBe('.txt');
      expect(getFileExtension('image.png')).toBe('.png');
      expect(getFileExtension('archive.tar.gz')).toBe('.gz');
    });

    it('should return empty string for files without extension', () => {
      expect(getFileExtension('README')).toBe('');
      expect(getFileExtension('Makefile')).toBe('');
    });

    it('should handle hidden files correctly', () => {
      expect(getFileExtension('.gitignore')).toBe('');
      expect(getFileExtension('.env')).toBe('');
    });

    it('should handle files ending with dot', () => {
      expect(getFileExtension('file.')).toBe('');
    });
  });

  describe('hasFileExtension', () => {
    it('should return true for files with extension', () => {
      expect(hasFileExtension('document.pdf')).toBe(true);
      expect(hasFileExtension('image.jpg')).toBe(true);
    });

    it('should return false for files without extension', () => {
      expect(hasFileExtension('README')).toBe(false);
      expect(hasFileExtension('Makefile')).toBe(false);
    });
  });

  describe('getExtensionByMimeType', () => {
    it('should return correct extension for common MIME types', () => {
      expect(getExtensionByMimeType('image/jpeg')).toBe('.jpg');
      expect(getExtensionByMimeType('image/png')).toBe('.png');
      expect(getExtensionByMimeType('application/pdf')).toBe('.pdf');
      expect(getExtensionByMimeType('text/plain')).toBe('.txt');
      expect(getExtensionByMimeType('video/mp4')).toBe('.mp4');
      expect(getExtensionByMimeType('audio/mpeg')).toBe('.mp3');
    });

    it('should handle MIME types with parameters', () => {
      expect(getExtensionByMimeType('text/html; charset=utf-8')).toBe('.html');
      expect(getExtensionByMimeType('application/json; charset=utf-8')).toBe('.json');
    });

    it('should return empty string for unknown MIME types', () => {
      expect(getExtensionByMimeType('unknown/type')).toBe('');
      expect(getExtensionByMimeType('')).toBe('');
    });

    it('should be case insensitive', () => {
      expect(getExtensionByMimeType('Image/JPEG')).toBe('.jpg');
      expect(getExtensionByMimeType('APPLICATION/PDF')).toBe('.pdf');
    });
  });

  describe('ensureFileExtension', () => {
    it('should return original filename if it already has extension', () => {
      expect(ensureFileExtension('document.txt', 'application/pdf')).toBe('document.txt');
      expect(ensureFileExtension('image.png', 'image/jpeg')).toBe('image.png');
    });

    it('should add extension based on MIME type if no extension', () => {
      expect(ensureFileExtension('document', 'application/pdf')).toBe('document.pdf');
      expect(ensureFileExtension('image', 'image/png')).toBe('image.png');
      expect(ensureFileExtension('video', 'video/mp4')).toBe('video.mp4');
    });

    it('should return original filename if no MIME type provided', () => {
      expect(ensureFileExtension('document')).toBe('document');
      expect(ensureFileExtension('Makefile')).toBe('Makefile');
    });

    it('should return original filename if MIME type is unknown', () => {
      expect(ensureFileExtension('document', 'unknown/type')).toBe('document');
    });

    it('should handle undefined MIME type', () => {
      expect(ensureFileExtension('document', undefined)).toBe('document');
    });
  });

  describe('getFileNameFromPath', () => {
    it('should extract filename from Unix path', () => {
      expect(getFileNameFromPath('/home/user/document.txt')).toBe('document.txt');
      expect(getFileNameFromPath('/var/log/app.log')).toBe('app.log');
    });

    it('should extract filename from Windows path', () => {
      expect(getFileNameFromPath('C:\\Users\\user\\document.txt')).toBe('document.txt');
      expect(getFileNameFromPath('D:\\folder\\file.pdf')).toBe('file.pdf');
    });

    it('should return filename if no path separator', () => {
      expect(getFileNameFromPath('document.txt')).toBe('document.txt');
    });
  });

  describe('generateUniqueFilename', () => {
    it('should return original filename if not in list', () => {
      expect(generateUniqueFilename('new.txt', ['old.txt'])).toBe('new.txt');
    });

    it('should add counter if filename exists', () => {
      expect(generateUniqueFilename('file.txt', ['file.txt'])).toBe('file(1).txt');
    });

    it('should increment counter until unique', () => {
      const existing = ['file.txt', 'file(1).txt', 'file(2).txt'];
      expect(generateUniqueFilename('file.txt', existing)).toBe('file(3).txt');
    });

    it('should handle files without extension', () => {
      expect(generateUniqueFilename('Makefile', ['Makefile'])).toBe('Makefile(1)');
    });
  });
});
