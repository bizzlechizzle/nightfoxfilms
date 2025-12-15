import fs from 'fs/promises';
import path from 'path';
import { MediaPathService } from './media-path-service';

/**
 * XmpService - Read and write XMP sidecar files
 *
 * Core Rules (DO NOT BREAK):
 * 1. XMP is source of truth - SQLite is a rebuildable cache
 * 2. Industry standard format - Compatible with PhotoMechanic, Lightroom, Bridge
 * 3. Never corrupt original files - Only write to .xmp sidecars
 * 4. Preserve unknown tags - Don't delete tags we don't understand
 */

export interface XmpData {
  rating?: number;           // xmp:Rating (0-5)
  label?: string;            // xmp:Label (color label)
  keywords?: string[];       // dc:subject
  title?: string;            // dc:title
  description?: string;      // dc:description
  creator?: string;          // dc:creator
  createDate?: string;       // xmp:CreateDate
  modifyDate?: string;       // xmp:ModifyDate
}

export class XmpService {
  // XMP namespace URIs
  private readonly NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  private readonly NS_XMP = 'http://ns.adobe.com/xap/1.0/';
  private readonly NS_DC = 'http://purl.org/dc/elements/1.1/';
  private readonly NS_XMP_MM = 'http://ns.adobe.com/xap/1.0/mm/';

  constructor(private readonly mediaPathService: MediaPathService) {}

  /**
   * Read XMP data from a sidecar file
   */
  async readXmp(xmpPath: string): Promise<XmpData | null> {
    try {
      const content = await fs.readFile(xmpPath, 'utf-8');
      return this.parseXmp(content);
    } catch (error) {
      // File doesn't exist or can't be read
      return null;
    }
  }

  /**
   * Write XMP data to a sidecar file
   */
  async writeXmp(xmpPath: string, data: XmpData): Promise<void> {
    const content = this.generateXmp(data);
    await fs.writeFile(xmpPath, content, 'utf-8');
  }

  /**
   * Parse XMP content into structured data
   * Basic XML parsing - for full support, use fast-xml-parser
   */
  private parseXmp(content: string): XmpData {
    const data: XmpData = {};

    // Extract rating
    const ratingMatch = content.match(/xmp:Rating[">](\d)/);
    if (ratingMatch) {
      data.rating = parseInt(ratingMatch[1], 10);
    }

    // Extract label
    const labelMatch = content.match(/xmp:Label[">]([^<"]+)/);
    if (labelMatch) {
      data.label = labelMatch[1];
    }

    // Extract title
    const titleMatch = content.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)/);
    if (titleMatch) {
      data.title = titleMatch[1];
    }

    // Extract description
    const descMatch = content.match(/<dc:description>[\s\S]*?<rdf:li[^>]*>([^<]+)/);
    if (descMatch) {
      data.description = descMatch[1];
    }

    // Extract keywords (dc:subject)
    const keywordsMatch = content.match(/<dc:subject>[\s\S]*?<rdf:Bag>([\s\S]*?)<\/rdf:Bag>/);
    if (keywordsMatch) {
      const keywordMatches = keywordsMatch[1].matchAll(/<rdf:li>([^<]+)<\/rdf:li>/g);
      data.keywords = [...keywordMatches].map(m => m[1]);
    }

    return data;
  }

  /**
   * Generate XMP content from structured data
   */
  private generateXmp(data: XmpData): string {
    const now = new Date().toISOString();

    let rdfContent = '';

    // Add rating
    if (data.rating !== undefined) {
      rdfContent += `      <xmp:Rating>${data.rating}</xmp:Rating>\n`;
    }

    // Add label
    if (data.label) {
      rdfContent += `      <xmp:Label>${this.escapeXml(data.label)}</xmp:Label>\n`;
    }

    // Add title
    if (data.title) {
      rdfContent += `      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${this.escapeXml(data.title)}</rdf:li>
        </rdf:Alt>
      </dc:title>\n`;
    }

    // Add description
    if (data.description) {
      rdfContent += `      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${this.escapeXml(data.description)}</rdf:li>
        </rdf:Alt>
      </dc:description>\n`;
    }

    // Add keywords
    if (data.keywords && data.keywords.length > 0) {
      rdfContent += `      <dc:subject>
        <rdf:Bag>\n`;
      for (const keyword of data.keywords) {
        rdfContent += `          <rdf:li>${this.escapeXml(keyword)}</rdf:li>\n`;
      }
      rdfContent += `        </rdf:Bag>
      </dc:subject>\n`;
    }

    // Add timestamps
    rdfContent += `      <xmp:ModifyDate>${now}</xmp:ModifyDate>\n`;
    if (data.createDate) {
      rdfContent += `      <xmp:CreateDate>${data.createDate}</xmp:CreateDate>\n`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="${this.NS_RDF}">
    <rdf:Description
      xmlns:xmp="${this.NS_XMP}"
      xmlns:dc="${this.NS_DC}"
      xmlns:xmpMM="${this.NS_XMP_MM}">
${rdfContent}    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
  }

  /**
   * Escape special characters for XML
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Check if XMP sidecar exists for a media file
   */
  async xmpExists(mediaPath: string): Promise<boolean> {
    const xmpPath = this.mediaPathService.getXmpPath(mediaPath);
    try {
      await fs.access(xmpPath);
      return true;
    } catch {
      return false;
    }
  }
}
