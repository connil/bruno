import styled from 'styled-components';

const StyledWrapper = styled.div`
  color: ${(props) => props.theme.colors.text.muted};
  font-size: 0.6875rem;
  line-height: 1rem;
  overflow-wrap: anywhere;
`;

export default StyledWrapper;
