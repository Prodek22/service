import { EmployeeStatus } from '@prisma/client';
import { google } from 'googleapis';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

const EMPLOYEE_SHEET_HEADERS = [
  'ID',
  'Status',
  'IBAN',
  'Luni in oras',
  'Porecla',
  'Nume complet',
  'Telefon',
  'Numar masina',
  'Angajator',
  'Recomandare',
  'Rank',
  'Updated At',
  'Poza buletin'
];

const COLUMN_WIDTHS = [70, 110, 190, 110, 170, 220, 140, 130, 170, 180, 130, 170, 320];

const requireSheetsConfig = () => {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    throw new Error(
      'Google Sheets nu este configurat. Seteaza GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY si GOOGLE_SHEETS_SPREADSHEET_ID.'
    );
  }
};

const getSheetsClient = () => {
  requireSheetsConfig();

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({
    version: 'v4',
    auth
  });
};

const formatCell = (value: Date | string | number | null | undefined): string => {
  if (value == null) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
};

export const exportEmployeesToGoogleSheets = async (): Promise<{
  spreadsheetId: string;
  sheetName: string;
  rowsWritten: number;
}> => {
  const sheets = getSheetsClient();
  const sheetName = env.GOOGLE_SHEETS_EMPLOYEES_TAB;
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID as string;

  const employees = await prisma.employee.findMany({
    where: {
      status: {
        not: EmployeeStatus.DELETED
      }
    },
    orderBy: [{ rank: 'asc' }, { nickname: 'asc' }, { fullName: 'asc' }, { id: 'asc' }]
  });

  const values = [
    EMPLOYEE_SHEET_HEADERS,
    ...employees.map((employee) => [
      formatCell(employee.id),
      formatCell(employee.status),
      formatCell(employee.iban),
      formatCell(employee.monthsInCity),
      formatCell(employee.nickname),
      formatCell(employee.fullName),
      formatCell(employee.phone),
      formatCell(employee.plateNumber),
      formatCell(employee.employerName),
      formatCell(employee.recommendation),
      formatCell(employee.rank),
      formatCell(employee.updatedAt),
      formatCell(employee.idImageUrl)
    ])
  ];

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A:Z`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values
    }
  });

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties'
  });

  const targetSheet = spreadsheet.data.sheets?.find((sheet) => sheet.properties?.title === sheetName);
  const sheetId = targetSheet?.properties?.sheetId;

  if (sheetId != null) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          },
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: {
                    red: 0.07,
                    green: 0.31,
                    blue: 0.38
                  },
                  textFormat: {
                    bold: true,
                    foregroundColor: {
                      red: 1,
                      green: 1,
                      blue: 1
                    }
                  },
                  horizontalAlignment: 'CENTER',
                  verticalAlignment: 'MIDDLE'
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'
            }
          },
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  verticalAlignment: 'MIDDLE',
                  wrapStrategy: 'WRAP'
                }
              },
              fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)'
            }
          },
          {
            setBasicFilter: {
              filter: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: values.length,
                  startColumnIndex: 0,
                  endColumnIndex: EMPLOYEE_SHEET_HEADERS.length
                }
              }
            }
          },
          ...COLUMN_WIDTHS.map((pixelSize, index) => ({
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: index,
                endIndex: index + 1
              },
              properties: {
                pixelSize
              },
              fields: 'pixelSize'
            }
          }))
        ]
      }
    });
  }

  return {
    spreadsheetId,
    sheetName,
    rowsWritten: employees.length
  };
};
