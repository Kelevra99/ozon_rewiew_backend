import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ParsedOzonWorkbook } from './ozon-import.types';

@Injectable()
export class OzonImportService {
  parseWorkbook(buffer: Buffer): ParsedOzonWorkbook {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets['Шаблон'];

    if (!sheet) {
      throw new BadRequestException('В файле не найден лист "Шаблон"');
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      range: 1,
      defval: null,
    });

    if (!rows.length) {
      throw new BadRequestException('В шаблоне нет строк товаров');
    }

    const headers = Object.keys(rows[0]);

    const productRows = rows.filter((row) => {
      const article = this.getString(row['Артикул*']);
      const name = this.getString(row['Название товара']);

      if (!article || !name) {
        return false;
      }

      if (this.isInstructionRow(article, name)) {
        return false;
      }

      return true;
    });

    if (!productRows.length) {
      throw new BadRequestException('После фильтрации в шаблоне не осталось строк товаров');
    }

    return {
      headers,
      rows: productRows,
    };
  }

  getAvailableExtraColumns(headers: string[]): string[] {
    const excluded = new Set([
      '№',
      'Артикул*',
      'Название товара',
      'Бренд*',
      'Бренд в одежде и обуви*',
      'Комплектация',
      'Состав комплекта',
      'Аннотация',
      'Ошибка',
      'Предупреждение',
      'Rich-контент JSON',
      'Таблица размеров JSON',
      'Ссылка на главное фото*',
      'Ссылки на дополнительные фото',
      'Ссылки на фото 360',
      'Артикул фото',
    ]);

    return headers.filter((header) => !excluded.has(header));
  }

  normalizeBaseFields(row: Record<string, unknown>) {
    const article = this.getString(row['Артикул*']);
    const name = this.getString(row['Название товара']);

    if (!article || !name) {
      throw new BadRequestException('В строке отсутствует Артикул* или Название товара');
    }

    return {
      article,
      name,
      brand:
        this.getString(row['Бренд*']) ||
        this.getString(row['Бренд в одежде и обуви*']) ||
        null,
      model:
        this.getString(row['Название модели для шаблона наименования']) ||
        this.getString(row['Модель']) ||
        null,
      groupKey:
        this.getString(row['Название модели (для объединения в одну карточку)*']) ||
        this.getString(row['Объединить на одной карточке*']) ||
        this.getString(row['Объединить в похожие товары']) ||
        null,
      kit:
        this.getString(row['Комплектация']) ||
        this.getString(row['Состав комплекта']) ||
        null,
      annotation: this.getString(row['Аннотация']) || null,
    };
  }

  buildSearchText(input: {
    article: string;
    name: string;
    brand?: string | null;
    model?: string | null;
    groupKey?: string | null;
    kit?: string | null;
    annotation?: string | null;
    extra1Value?: string | null;
    extra2Value?: string | null;
  }) {
    return [
      input.article,
      input.name,
      input.brand,
      input.model,
      input.groupKey,
      input.kit,
      input.annotation,
      input.extra1Value,
      input.extra2Value,
    ]
      .filter(Boolean)
      .join(' | ');
  }

  private isInstructionRow(article: string, name: string): boolean {
    const articleLower = article.toLowerCase();
    const nameLower = name.toLowerCase();

    return (
      articleLower.includes('введите артикул') ||
      nameLower.includes('ознакомьтесь с требованиями') ||
      articleLower.includes('seller-edu.ozon.ru') ||
      nameLower.includes('seller-edu.ozon.ru')
    );
  }

  private getString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }
}