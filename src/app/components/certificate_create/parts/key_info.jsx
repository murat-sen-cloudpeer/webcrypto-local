import React, { PropTypes, Component } from 'react';
import styled from 'styled-components';
import { SelectField, SelectItem, Checkbox, SelectNative } from '../../basic';
import { Title, GroupContainer, GroupPart } from './styles';
import enLang from '../../../langs/en.json';

const CheckboxContainer = styled.div`
  display: inline-block;
  vertical-align: top;
  margin-right: 40px;
  margin-top: 14px;
  &:last-child {
    margin-right: 0;
  }
  @media ${props => props.theme.media.mobile} {
    margin-right: 12px;
    width: calc(50% - 6px);
    &:nth-child(2n) {
      margin-right: 0;
    }
  }
`;

const TitleCheckboxes = styled.div`
  font-size: 12px;
  line-height: 16px;
  display: block;
  width: 100%;
  letter-spacing: 0.04em;
  color: ${props => props.theme.field.text.labelColor};
`;

const TextFieldContainer = styled.div`
  display: inline-block;
  width: calc(33.3% - 16px);
  vertical-align: top;
  margin-left: 24px;
  &:first-child {
    margin-left: 0;
  }
  @media ${props => props.theme.media.mobile} {
    margin-left: 0;
    width: 100%;
    margin-top: 15px;
  }
`;

export default class KeyInfo extends Component {

  static propTypes = {
    parameters: PropTypes.oneOfType([
      PropTypes.object,
    ]),
  };

  static contextTypes = {
    deviceType: PropTypes.string,
  };

  constructor(props) {
    super();

    this.keyInfoData = props.parameters.RSA;
    this.checkboxNodes = {};
    this.fieldNodes = {};

    this.state = {
      algorithmValue: {
        name: this.keyInfoData[0].name,
        value: this.keyInfoData[0].name,
        index: 0,
      },
    };
  }

  handleChangeAlgorithm = (data) => {
    let value = data;
    if (typeof data !== 'object') {
      let index = 0;
      this.keyInfoData.map((key, _index) => {
        if (key.name === data) {
          index = _index;
        }
      });
      value = {
        value: data,
        name: data,
        index,
      }
    }
    this.setState({
      algorithmValue: value,
    });
  };

  isValidFields = () => {
    this.validateFields();
    const { fieldNodes } = this;
    let valid = true;

    Object.keys(fieldNodes).map((field) => {
      const node = fieldNodes[field];
      if (!node.isValid()) {
        valid = false;
      }
    });

    return valid;
  };

  validateFields() {
    const { fieldNodes } = this;

    Object.keys(fieldNodes).map((field) => (
      fieldNodes[field].validate()
    ));
  }

  getData = () => {
    const { fieldNodes } = this;
    const data = {};
    const usagesArr = [];

    Object.keys(fieldNodes).map((field) => {
      const node = fieldNodes[field];
      if ({}.hasOwnProperty.call(node, 'getData')) {
        data[field] = node.getData().value;
      } else {
        data[field] = node.getValue();
      }
    });

    Object.keys(this.checkboxNodes).map((usageNode) => {
      const node = this.checkboxNodes[usageNode];
      if (node && node.getValue()) {
        usagesArr.push(usageNode);
      }
      return true;
    });

    return {
      keyInfo: {
        ...data,
        usages: usagesArr,
      }
    };
  };

  render() {
    const { keyInfoData } = this;
    const { algorithmValue } = this.state;
    const { deviceType } = this.context;
    const currentAlgorithmData = keyInfoData[algorithmValue.index];

    return (
      <GroupContainer>
        <Title>
          { enLang['CertificateCreate.KeyInfo.Title'] }
        </Title>
        <GroupPart>
          <TextFieldContainer>
            {
              deviceType === 'phone'
              ? <SelectNative
                labelText={enLang['CertificateCreate.KeyInfo.Field.Algorithm']}
                placeholder="Select algorithm..."
                ref={node => (this.fieldNodes.algorithm = node)}
                options={keyInfoData.map((key) => {
                  key.value = key.name;
                  return key;
                })}
                onChange={this.handleChangeAlgorithm}
                value={algorithmValue.value}
              />
              : <SelectField
                labelText={enLang['CertificateCreate.KeyInfo.Field.Algorithm']}
                name="algorithm"
                ref={node => (this.fieldNodes.algorithm = node)}
                placeholder="Select algorithm..."
                onChange={this.handleChangeAlgorithm}
                value={algorithmValue}
              >
                {
                  keyInfoData.map((item, index) => (
                    <SelectItem
                      key={index}
                      value={item.name}
                      primaryText={item.name}
                    />
                  ))
                }
              </SelectField>
            }
          </TextFieldContainer>
          <TextFieldContainer>
            {
              deviceType === 'phone'
              ? <SelectNative
                labelText={enLang['CertificateCreate.KeyInfo.Field.Size']}
                placeholder="Select size..."
                ref={node => (this.fieldNodes.size = node)}
                options={currentAlgorithmData.modulusLength.map((module) => ({
                  value: module,
                }))}
                defaultValue={currentAlgorithmData.modulusLength[0]}
              />
              : <SelectField
                labelText={enLang['CertificateCreate.KeyInfo.Field.Size']}
                name="size"
                ref={node => (this.fieldNodes.size = node)}
                placeholder="Select size..."
                defaultSelected={{
                  name: currentAlgorithmData.modulusLength[0],
                  value: currentAlgorithmData.modulusLength[0],
                  index: 0,
                }}
              >
                {
                  currentAlgorithmData.modulusLength.map((item, index) => (
                    <SelectItem
                      key={index}
                      value={item}
                      primaryText={item}
                    />
                  ))
                }
              </SelectField>
            }
          </TextFieldContainer>
        </GroupPart>
        <GroupPart>
          <TitleCheckboxes>
            { enLang['CertificateCreate.KeyInfo.Usage.Title'] }
          </TitleCheckboxes>
          {
            currentAlgorithmData.usages.map((usage, index) => (
              <CheckboxContainer key={index}>
                <Checkbox
                  labelText={usage}
                  ref={node => (this.checkboxNodes[usage] = node)}
                />
              </CheckboxContainer>
            ))
          }
        </GroupPart>
      </GroupContainer>
    );
  }
}
