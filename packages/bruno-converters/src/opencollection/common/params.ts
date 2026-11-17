import { uuid } from '../../common/index.js';
import type {
  HttpRequestParam,
  BrunoHttpRequestParam,
  BrunoHttpRequestParamType
} from '../types';

type BrunoQueryParamEncoding = {
  encodeName?: boolean;
  encodeValue?: boolean;
  encodeValueAsBase64?: boolean;
};

type HttpRequestParamWithBrunoEncoding = HttpRequestParam & {
  extensions?: {
    bruno?: {
      queryParamEncoding?: BrunoQueryParamEncoding;
    };
  };
};

export const fromOpenCollectionParams = (params: HttpRequestParam[] | undefined): BrunoHttpRequestParam[] => {
  if (!params?.length) {
    return [];
  }

  return params.map((param): BrunoHttpRequestParam => {
    const entry: BrunoHttpRequestParam = {
      uid: uuid(),
      name: param.name || '',
      value: param.value || '',
      type: (param.type || 'query') as BrunoHttpRequestParamType,
      enabled: param.disabled !== true
    };
    const queryParamEncoding = (param as HttpRequestParamWithBrunoEncoding).extensions?.bruno?.queryParamEncoding;
    if (typeof queryParamEncoding?.encodeName === 'boolean') entry.encodeName = queryParamEncoding.encodeName;
    if (typeof queryParamEncoding?.encodeValue === 'boolean') entry.encodeValue = queryParamEncoding.encodeValue;
    if (typeof queryParamEncoding?.encodeValueAsBase64 === 'boolean') {
      entry.encodeValueAsBase64 = queryParamEncoding.encodeValueAsBase64;
    }
    const desc = typeof param.description === 'string' ? param.description : param.description?.content;
    if (desc && desc.trim().length) entry.description = desc;
    return entry;
  });
};

export const toOpenCollectionParams = (params: BrunoHttpRequestParam[] | null | undefined): HttpRequestParam[] | undefined => {
  if (!params?.length) {
    return undefined;
  }

  const ocParams = params.map((param): HttpRequestParam => {
    const httpParam: HttpRequestParamWithBrunoEncoding = {
      name: param.name || '',
      value: param.value || '',
      type: param.type || 'query'
    };

    if (param.description && typeof param.description === 'string' && param.description.trim().length) {
      httpParam.description = param.description;
    }

    if (param.enabled === false) {
      httpParam.disabled = true;
    }

    const queryParamEncoding: BrunoQueryParamEncoding = {};
    if (param.encodeName === false) queryParamEncoding.encodeName = false;
    if (param.encodeValue === false) queryParamEncoding.encodeValue = false;
    if (param.encodeValueAsBase64 === true) queryParamEncoding.encodeValueAsBase64 = true;
    if (Object.keys(queryParamEncoding).length) {
      httpParam.extensions = { bruno: { queryParamEncoding } };
    }

    return httpParam;
  });

  return ocParams.length ? ocParams : undefined;
};
