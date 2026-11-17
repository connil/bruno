import type { HttpRequestParam as BrunoHttpRequestParam } from '@usebruno/schema-types/requests/http';
import type { HttpRequestParam } from '@opencollection/types/requests/http';
import { uuid, ensureString } from '../../../utils';

type BrunoQueryParamEncoding = {
  encodeName?: boolean;
  encodeValue?: boolean;
  encodeValueAsBase64?: boolean;
};

type OpenCollectionParamWithBrunoEncoding = HttpRequestParam & {
  extensions?: {
    bruno?: {
      queryParamEncoding?: BrunoQueryParamEncoding;
    };
  };
};

export const toOpenCollectionParams = (params: BrunoHttpRequestParam[] | null | undefined): HttpRequestParam[] | undefined => {
  if (!params?.length) {
    return undefined;
  }

  // Request files carry one selected value per name; alternatives live in the collection sidecar.
  const selectedPaths = new Map<BrunoHttpRequestParam['name'], BrunoHttpRequestParam>();
  for (const param of params) {
    if (param.type !== 'path') continue;
    const previous = selectedPaths.get(param.name);
    if (!previous || (previous.enabled === false && param.enabled !== false)) selectedPaths.set(param.name, param);
  }
  const ocParams = params.filter((param) => param.type !== 'path' || selectedPaths.get(param.name) === param).map((param: BrunoHttpRequestParam): HttpRequestParam => {
    const ocParam: HttpRequestParam = {
      name: param.name || '',
      value: param.type === 'path' && param.enabled === false ? '' : param.value || '',
      type: param.type
    };

    if (param?.description?.trim().length) {
      ocParam.description = param.description;
    }

    if (param.enabled === false && param.type !== 'path') {
      ocParam.disabled = true;
    }

    return ocParam;
  });

  return ocParams.length ? ocParams : undefined;
};

export const toBrunoParams = (params: HttpRequestParam[] | null | undefined): BrunoHttpRequestParam[] | undefined => {
  if (!params?.length) {
    return undefined;
  }

  const brunoParams = params.map((param: HttpRequestParam): BrunoHttpRequestParam => {
    const brunoParam: BrunoHttpRequestParam = {
      uid: uuid(),
      name: ensureString(param.name),
      value: ensureString(param.value),
      type: param.type,
      enabled: param.disabled !== true
    };
    const queryParamEncoding = (param as OpenCollectionParamWithBrunoEncoding).extensions?.bruno?.queryParamEncoding;
    if (typeof queryParamEncoding?.encodeName === 'boolean') brunoParam.encodeName = queryParamEncoding.encodeName;
    if (typeof queryParamEncoding?.encodeValue === 'boolean') brunoParam.encodeValue = queryParamEncoding.encodeValue;
    if (typeof queryParamEncoding?.encodeValueAsBase64 === 'boolean') {
      brunoParam.encodeValueAsBase64 = queryParamEncoding.encodeValueAsBase64;
    }

    if (param.description) {
      if (typeof param.description === 'string' && param.description.trim().length) {
        brunoParam.description = param.description;
      } else if (typeof param.description === 'object' && param.description.content?.trim().length) {
        brunoParam.description = param.description.content;
      }
    }

    return brunoParam;
  });

  return brunoParams.length ? brunoParams : undefined;
};
