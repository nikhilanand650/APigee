var xmlContent = context.getVariable('request.content');


var startTagPattern = "<ApigeeRootObject>";
var endTagPattern = "</ApigeeRootObject>";
var SB_rootObject = context.getVariable("SB_rootObject")
var startTagReplacement = '<ser:' + SB_rootObject + ' xmlns:ser="http://namespace.com">';
var endTagReplacement = '</ser:' + SB_rootObject + '>';
var newXml ='';

if (xmlContent.includes(startTagPattern))
{
newXml = xmlContent
    .replace(startTagPattern, startTagReplacement)
    .replace(endTagPattern, endTagReplacement);
}
else {

newXml =  startTagReplacement + xmlContent + endTagReplacement;

}
context.setVariable('request.content', newXml);
