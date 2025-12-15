import path from 'path';
import { existsSync } from 'fs';

/**
 * Path validation service for security
 * Prevents path traversal attacks
 */
export class PathValidator {
  /**
   * Validate that a file path is safe and doesn't escape allowed directories
   */
  static isPathSafe(filePath: string, allowedBaseDir: string): boolean {
    try {
      // Resolve to absolute paths
      const resolvedPath = path.resolve(filePath);
      const resolvedBase = path.resolve(allowedBaseDir);

      // SECURITY: Must include path separator to prevent /archive matching /archiveXYZ
      // The path must either BE the base dir or START WITH base dir + separator
      return resolvedPath === resolvedBase || resolvedPath.startsWith(resolvedBase + path.sep);
    } catch (error) {
      console.error('Path validation error:', error);
      return false;
    }
  }

  /**
   * Validate that a file path exists and is under allowed directory
   */
  static async validateImportPath(filePath: string, allowedDirs: string[]): Promise<boolean> {
    if (!existsSync(filePath)) {
      return false;
    }

    // Check if path is under any allowed directory
    const resolvedPath = path.resolve(filePath);

    for (const allowedDir of allowedDirs) {
      if (this.isPathSafe(resolvedPath, allowedDir)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sanitize filename to prevent directory traversal
   */
  static sanitizeFilename(filename: string): string {
    // Remove path separators and parent directory references
    return filename
      .replace(/\.\./g, '')
      .replace(/[/\\]/g, '')
      .replace(/^\.+/, '');
  }

  /**
   * Validate archive path doesn't escape archive directory
   */
  static validateArchivePath(targetPath: string, archiveRoot: string): boolean {
    const resolved = path.resolve(targetPath);
    const resolvedRoot = path.resolve(archiveRoot);

    return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
  }
}
