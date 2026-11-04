import { ApiRequestError, NetworkError } from '@mp/api-client';
import { RegisterRequest } from '@mp/contracts';
import { createTranslator } from '@mp/i18n';
import { describe, expect, it } from 'vitest';

import { apiErrorMessage, validationErrors } from './form-errors';

const t = createTranslator('ru');
const problem = (
  status: number,
  code: 'UNAUTHENTICATED' | 'CONFLICT' | 'RATE_LIMITED' | 'BAD_REQUEST',
) => new ApiRequestError(status, { type: '/p', title: 'x', status, code });

describe('validationErrors', () => {
  it('localizes contract validation per field', () => {
    const result = RegisterRequest.safeParse({ email: 'nope', password: 'short', displayName: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(validationErrors(result.error, t)).toEqual({
      email: 'Введите корректный email.',
      password: 'От 10 до 128 символов.',
      displayName: 'Заполните это поле.',
    });
  });

  it('explains a password equal to the email', () => {
    const result = RegisterRequest.safeParse({
      email: 'long-enough@x.co',
      password: 'long-enough@x.co',
      displayName: 'A',
    });
    if (result.success) throw new Error('expected failure');
    expect(validationErrors(result.error, t).password).toBe('Пароль не должен совпадать с email.');
  });
});

describe('apiErrorMessage', () => {
  it('depends on the screen the error happened on', () => {
    expect(apiErrorMessage(problem(401, 'UNAUTHENTICATED'), t, 'login')).toBe(
      'Неверный email или пароль.',
    );
    expect(apiErrorMessage(problem(401, 'UNAUTHENTICATED'), t)).toBe(
      'Сеанс завершён. Войдите снова.',
    );
    expect(apiErrorMessage(problem(409, 'CONFLICT'), t, 'register')).toBe(
      'Аккаунт с таким email уже существует.',
    );
    expect(apiErrorMessage(problem(400, 'BAD_REQUEST'), t, 'link')).toBe(
      'Ссылка недействительна или устарела.',
    );
    expect(apiErrorMessage(problem(429, 'RATE_LIMITED'), t)).toBe(
      'Слишком много попыток. Попробуйте позже.',
    );
  });

  it('treats network and gateway failures as unavailability', () => {
    expect(apiErrorMessage(new NetworkError(new Error('x')), t)).toBe(
      'Нет связи с сервером. Проверьте подключение.',
    );
    expect(apiErrorMessage(new ApiRequestError(502, null), t)).toBe(
      'Сервис временно недоступен. Попробуйте через минуту.',
    );
    expect(apiErrorMessage(new Error('x'), t)).toBe('Что-то пошло не так. Попробуйте ещё раз.');
  });
});
