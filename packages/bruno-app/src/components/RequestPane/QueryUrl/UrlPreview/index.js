import React from 'react';
import { IconCheck, IconCopy } from '@tabler/icons';
import toast from 'react-hot-toast';
import useCopyToClipboard from 'hooks/useCopyToClipboard';
import ActionIcon from 'ui/ActionIcon';
import { getAllVariables } from 'utils/collections';
import { interpolateUrl, interpolateUrlPathParams, splitUrlQuery } from 'utils/url';
import StyledWrapper from './StyledWrapper';

const UrlPreview = ({ item, collection }) => {
  const { copied, copyToClipboard } = useCopyToClipboard();
  const { request } = item.draft || item;
  const url = request.url || '';

  if (!splitUrlQuery(url).pathname) {
    return null;
  }

  const variables = getAllVariables(collection, item);
  const preview = interpolateUrlPathParams(
    interpolateUrl({ url, variables }),
    request.params || [],
    variables,
    { raw: true }
  );

  const handleCopy = async () => {
    try {
      await copyToClipboard(preview);
    } catch (error) {
      toast.error('Failed to copy URL');
    }
  };

  return (
    <StyledWrapper className="mt-1 w-full flex items-start gap-1" data-testid="request-url-preview" aria-label="URL preview">
      <span className="preview-url min-w-0">{preview}</span>
      <ActionIcon
        type="button"
        size="xs"
        className="shrink-0"
        aria-label="Copy URL"
        label={copied ? 'Copied' : 'Copy URL'}
        data-testid="copy-request-url"
        onClick={handleCopy}
      >
        {copied ? <IconCheck size={14} strokeWidth={1.5} /> : <IconCopy size={14} strokeWidth={1.5} />}
      </ActionIcon>
    </StyledWrapper>
  );
};

export default UrlPreview;
