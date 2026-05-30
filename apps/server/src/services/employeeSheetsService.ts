import { EmployeeStatus } from '@prisma/client';
import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

const EMPLOYEE_SHEET_HEADERS = [
  'IBAN',
  'Luni in oras',
  'Porecla',
  'Nume complet',
  'Telefon',
  'Numar masina',
  'Rank'
];

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
      formatCell(employee.iban),
      formatCell(employee.monthsInCity),
      formatCell(employee.nickname),
      formatCell(employee.fullName),
      formatCell(employee.phone),
      formatCell(employee.plateNumber),
      formatCell(employee.rank)
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
    fields: 'sheets(properties.sheetId,properties.title,bandedRanges.bandedRangeId)'
  });

  const targetSheet = spreadsheet.data.sheets?.find((sheet) => sheet.properties?.title === sheetName);
  const sheetId = targetSheet?.properties?.sheetId;
  const existingBandingIds =
    targetSheet?.bandedRanges?.map((bandedRange) => bandedRange.bandedRangeId).filter((value): value is number => value != null) ?? [];

  if (sheetId != null) {
    const requests: sheets_v4.Schema$Request[] = [
      ...existingBandingIds.map((bandedRangeId) => ({
        deleteBanding: {
          bandedRangeId
        }
      })),
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
                fontFamily: 'Verdana',
                fontSize: 16,
                foregroundColor: {
                  red: 1,
                  green: 1,
                  blue: 1
                }
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              borders: {
                bottom: {
                  style: 'SOLID',
                  color: {
                    red: 0.04,
                    green: 0.19,
                    blue: 0.23
                  }
                }
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)'
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
              textFormat: {
                fontFamily: 'Verdana',
                fontSize: 16,
                bold: true
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
              borders: {
                bottom: {
                  style: 'SOLID',
                  color: {
                    red: 0.89,
                    green: 0.92,
                    blue: 0.95
                  }
                }
              }
            }
          },
          fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders)'
        }
      },
      {
        addBanding: {
          bandedRange: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: values.length,
              startColumnIndex: 0,
              endColumnIndex: EMPLOYEE_SHEET_HEADERS.length
            },
            rowProperties: {
              headerColor: {
                red: 0.07,
                green: 0.31,
                blue: 0.38
              },
              firstBandColor: {
                red: 0.98,
                green: 0.99,
                blue: 1
              },
              secondBandColor: {
                red: 0.94,
                green: 0.97,
                blue: 0.99
              }
            }
          }
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
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: EMPLOYEE_SHEET_HEADERS.length
          }
        }
      }
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests
      }
    });
  }

  return {
    spreadsheetId,
    sheetName,
    rowsWritten: employees.length
  };
};
