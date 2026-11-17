import React from 'react';
import SensitiveFieldWarning from 'components/SensitiveFieldWarning';
import get from 'lodash/get';
import { useTheme } from 'providers/Theme';
import { useDispatch } from 'react-redux';
import SingleLineEditor from 'components/SingleLineEditor';
import { sendRequest, saveRequest } from 'providers/ReduxStore/slices/collections/actions';
import StyledWrapper from './StyledWrapper';

const BearerAuth = ({ item, collection, updateAuth, request, save, readOnly }) => {
  const dispatch = useDispatch();
  const { storedTheme } = useTheme();

  const bearer = get(request, 'auth.bearer', {});
  const bearerToken = get(request, 'auth.bearer.token', '');
  const prefix = bearer?.prefix ?? 'Bearer';

  const handleRun = () => dispatch(sendRequest(item, collection.uid));

  const handleSave = () => {
    if (save) {
      save();
    } else {
      dispatch(saveRequest(item.uid, collection.uid));
    }
  };

  const handleTokenChange = (token) => {
    dispatch(
      updateAuth({
        mode: 'bearer',
        collectionUid: collection.uid,
        itemUid: item.uid,
        content: {
          ...bearer,
          token: token
        }
      })
    );
  };

  const handlePrefixChange = (prefix) => {
    dispatch(
      updateAuth({
        mode: 'bearer',
        collectionUid: collection.uid,
        itemUid: item.uid,
        content: { ...bearer, prefix }
      })
    );
  };

  return (
    <StyledWrapper className="w-full">
      <label className="block mb-1">Token</label>
      <div className="single-line-editor-wrapper flex items-center">
        <SingleLineEditor
          value={bearerToken}
          theme={storedTheme}
          onSave={handleSave}
          onChange={(val) => handleTokenChange(val)}
          onRun={handleRun}
          collection={collection}
          item={item}
          isSecret={true}
          readOnly={readOnly}
          isCompact
        />
        <SensitiveFieldWarning fieldName="bearer-token" secretName="token" value={bearerToken} collection={collection} item={item} fieldKey="token" onReplaceValue={handleTokenChange} />
      </div>
      <label className="block mt-3 mb-1">Prefix</label>
      <div className="single-line-editor-wrapper flex items-center" data-testid="bearer-prefix">
        <SingleLineEditor
          value={prefix}
          theme={storedTheme}
          onSave={handleSave}
          onChange={handlePrefixChange}
          onRun={handleRun}
          collection={collection}
          item={item}
          readOnly={readOnly}
          isCompact
        />
      </div>
    </StyledWrapper>
  );
};

export default BearerAuth;
