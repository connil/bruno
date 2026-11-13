import React from 'react';
import { getAllVariables } from 'utils/collections';
import { interpolateUrl, interpolateUrlPathParams } from 'utils/url';
import StyledWrapper from './StyledWrapper';

const UrlPreview = ({ item, collection }) => {
  const { request } = item.draft || item;
  const url = request.url || '';

  if (!url) {
    return null;
  }

  const variables = getAllVariables(collection, item);
  const preview = interpolateUrlPathParams(
    interpolateUrl({ url, variables }),
    request.params || [],
    variables,
    { raw: true }
  );

  return (
    <StyledWrapper className="mt-1 w-full" data-testid="request-url-preview" aria-label="URL preview">
      {preview}
    </StyledWrapper>
  );
};

export default UrlPreview;
